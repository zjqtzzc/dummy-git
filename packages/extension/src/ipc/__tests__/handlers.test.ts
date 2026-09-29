import { GitDomain, MessageKind, RefKind, ResponseKind } from "@dummy-git/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cli, fixtures } from "../../__tests__/support.js";
import { Repository } from "../../core/repository.js";
import { getRepositoryLocation } from "../../git/commands/index.js";
import { createHandlers } from "../handlers.js";
import { Router, type Transport } from "../router.js";

/**
 * 这一组走的是**除 webview 之外的整条链**：
 * 协议 → router → handlers → Repository → 队列 → 命令层 → 进程层 → 真的 git。
 *
 * 唯一没覆盖的是 `postMessage` 本身，那部分只能 F5 验。
 */
describe("handlers：协议接到真仓库上", () => {
  let repository: Repository;
  beforeAll(async () => {
    repository = new Repository(await getRepositoryLocation.execute(cli, fixtures.base), cli);
  });
  afterAll(() => repository.dispose());

  it("getRepositories 返回仓库根——webview 的第一句话", async () => {
    // 这是启动链的第一环：不知道有哪些仓库，别的命令连参数都凑不出来。
    const roots = await createHandlers(repository).getRepositories({});
    expect(roots).toEqual([repository.location.root]);
  });

  it("getSkeleton 拿到真实提交", async () => {
    const skeleton = await createHandlers(repository).getSkeleton({
      repo: repository.location.root,
    });
    expect(skeleton.length).toBeGreaterThan(3);
    expect(skeleton[0]?.hash).toHaveLength(40);
  });

  it("getCommitDetails 按 hash 取到详情", async () => {
    const handlers = createHandlers(repository);
    const skeleton = await handlers.getSkeleton({ repo: repository.location.root });
    const hashes = skeleton.slice(0, 2).map((c) => c.hash);

    const details = await handlers.getCommitDetails({ repo: repository.location.root, hashes });
    expect(details).toHaveLength(2);
    expect(details[0]?.author.name).not.toBe("");
  });

  it("getCommitFiles 拿到那条提交改了哪些文件", async () => {
    const handlers = createHandlers(repository);
    const skeleton = await handlers.getSkeleton({ repo: repository.location.root });
    const hash = skeleton.at(-1)?.hash;
    expect(hash).toBeDefined();

    const files = await handlers.getCommitFiles({
      repo: repository.location.root,
      hash: hash ?? "",
    });
    expect(files.length).toBeGreaterThan(0);
  });

  it("getRefs：第一条是 HEAD，其后是分支与 tag——左栏一次拿全", async () => {
    const refs = await createHandlers(repository).getRefs({ repo: repository.location.root });
    expect(refs[0]).toMatchObject({ kind: RefKind.Head, branch: "main" });
    expect(refs).toContainEqual(
      expect.objectContaining({ kind: RefKind.LocalBranch, name: "feat" }),
    );
  });

  it("getRefs：detached 时 HEAD 没有 branch 字段", async () => {
    const detached = new Repository(
      await getRepositoryLocation.execute(cli, fixtures.detached),
      cli,
    );
    try {
      const [head] = await createHandlers(detached).getRefs({ repo: detached.location.root });
      expect(head?.kind).toBe(RefKind.Head);
      expect(head).not.toHaveProperty("branch");
    } finally {
      detached.dispose();
    }
  });

  it("经 Router 走一遍：请求进去，Ok 响应出来", async () => {
    // 与上面三条的区别：这条经过了**边界校验**与**信封**，
    // 也就是真实运行时 webview 那一侧看到的东西。
    const sent: unknown[] = [];
    const transport: Transport = { post: (m) => void sent.push(m) };
    const router = new Router(transport, createHandlers(repository));

    router.receive({ kind: MessageKind.Ready, generation: "g1" });
    router.receive({
      kind: MessageKind.Request,
      generation: "g1",
      id: 1,
      command: "getSkeleton",
      params: { repo: repository.location.root },
    });

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ id: 1, generation: "g1", result: ResponseKind.Ok });
  });

  it("失败也能经 Router 变成错误响应", async () => {
    const sent: unknown[] = [];
    const router = new Router({ post: (m) => void sent.push(m) }, createHandlers(repository));

    router.receive({ kind: MessageKind.Ready, generation: "g1" });
    router.receive({
      kind: MessageKind.Request,
      generation: "g1",
      id: 2,
      command: "getCommitFiles",
      // 不存在的 hash：git 会失败，M4 分类，router 转成错误响应。
      params: { repo: repository.location.root, hash: "0".repeat(40) },
    });

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ id: 2, result: ResponseKind.Error });
  });
});

describe("闭环：仓库变了 → 广播到面板", () => {
  it("git 路径变化 → 分域 → 广播，只说哪些域过期，不带数据", async () => {
    // 这是 M7 闭环的最后一段，链路：
    //   watcher（vscode，唯一没覆盖的一环）→ repo.notifyGitPath
    //   → M6 分类/防抖 → onDidChange → router.broadcast → transport
    const repository = new Repository(await getRepositoryLocation.execute(cli, fixtures.base), cli);
    const sent: unknown[] = [];
    const router = new Router({ post: (m) => void sent.push(m) }, createHandlers(repository));
    repository.onDidChange((domains) => router.broadcast(repository.location.root, [...domains]));

    router.receive({ kind: MessageKind.Ready, generation: "g1" });
    repository.notifyGitPath("HEAD");
    repository.flushPending();

    expect(sent).toEqual([
      {
        kind: MessageKind.Event,
        generation: "g1",
        event: "domainsChanged",
        // HEAD 变了给**两个**域：切分支同时改 ref 与工作区文件（`core/classify.ts`）。
        // 写这条时我先按 [Refs] 断言，是断言错了不是实现错了——
        // 失败时先去读实现的理由，别顺手把测试改成「实现现在输出什么」。
        payload: { repo: repository.location.root, domains: [GitDomain.Refs, GitDomain.Worktree] },
      },
    ]);
    repository.dispose();
  });

  it("握手之前的变化不广播——那一条会静静地丢掉", async () => {
    const repository = new Repository(await getRepositoryLocation.execute(cli, fixtures.base), cli);
    const sent: unknown[] = [];
    const router = new Router({ post: (m) => void sent.push(m) }, createHandlers(repository));
    repository.onDidChange((domains) => router.broadcast(repository.location.root, [...domains]));

    // 没有 ready
    repository.notifyGitPath("HEAD");
    repository.flushPending();

    expect(sent).toHaveLength(0);
    repository.dispose();
  });

  it("退订之后这个面板不再收到广播", async () => {
    // 面板关了要退订。不退的话监听器只增不减。
    const repository = new Repository(await getRepositoryLocation.execute(cli, fixtures.base), cli);
    const sent: unknown[] = [];
    const router = new Router({ post: (m) => void sent.push(m) }, createHandlers(repository));
    const unsubscribe = repository.onDidChange((domains) =>
      router.broadcast(repository.location.root, [...domains]),
    );
    router.receive({ kind: MessageKind.Ready, generation: "g1" });

    unsubscribe();
    repository.notifyGitPath("HEAD");
    repository.flushPending();

    expect(sent).toHaveLength(0);
    repository.dispose();
  });
});
