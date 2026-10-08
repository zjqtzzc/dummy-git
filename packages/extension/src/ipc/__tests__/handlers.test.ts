import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  DiffOpenMode,
  type DiffSide,
  DiffSideKind,
  GitDomain,
  MessageKind,
  RefKind,
  ResponseKind,
} from "@dummy-git/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  cleanupTempRepos,
  cli,
  fixtures,
  git,
  makeTempRepo,
  makeTrackingRepos,
  plainLocation,
} from "../../__tests__/support.js";
import { Repository } from "../../core/repository.js";
import { getRepositoryLocation } from "../../git/commands/index.js";
import { createHandlers, type HandlerUi } from "../handlers.js";
import { UserFacingError } from "../userFacingError.js";

/** 不涉及界面的测试用它：真调到就说明测错了东西。 */
const NO_UI: HandlerUi = {
  confirmRollback: () => Promise.reject(new Error("测试里不该弹确认")),
  withProgress: (_title, task) => task(),
  openDiff: () => Promise.reject(new Error("测试里不该打开 diff")),
};

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
    const roots = await createHandlers(repository, NO_UI).getRepositories({});
    expect(roots).toEqual([repository.location.root]);
  });

  it("getSkeleton 拿到真实提交", async () => {
    const skeleton = await createHandlers(repository, NO_UI).getSkeleton({
      repo: repository.location.root,
    });
    expect(skeleton.length).toBeGreaterThan(3);
    expect(skeleton[0]?.hash).toHaveLength(40);
  });

  it("getCommitDetails 按 hash 取到详情", async () => {
    const handlers = createHandlers(repository, NO_UI);
    const skeleton = await handlers.getSkeleton({ repo: repository.location.root });
    const hashes = skeleton.slice(0, 2).map((c) => c.hash);

    const details = await handlers.getCommitDetails({ repo: repository.location.root, hashes });
    expect(details).toHaveLength(2);
    expect(details[0]?.author.name).not.toBe("");
  });

  it("getCommitFiles 拿到那条提交改了哪些文件", async () => {
    const handlers = createHandlers(repository, NO_UI);
    const skeleton = await handlers.getSkeleton({ repo: repository.location.root });
    const hash = skeleton.at(-1)?.hash;
    expect(hash).toBeDefined();

    const files = await handlers.getCommitFiles({
      repo: repository.location.root,
      hash: hash ?? "",
    });
    expect(files.length).toBeGreaterThan(0);
  });

  it("getStatus 拿到工作区的改动——Commit 面板的数据", async () => {
    const status = await createHandlers(repository, NO_UI).getStatus({
      repo: repository.location.root,
    });
    expect(status.changes.length).toBeGreaterThan(0);
    expect(status.head).toHaveLength(40);
  });

  it("getRefs：第一条是 HEAD，其后是分支与 tag——左栏一次拿全", async () => {
    const refs = await createHandlers(repository, NO_UI).getRefs({
      repo: repository.location.root,
    });
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
      const [head] = await createHandlers(detached, NO_UI).getRefs({
        repo: detached.location.root,
      });
      expect(head?.kind).toBe(RefKind.Head);
      expect(head).not.toHaveProperty("branch");
    } finally {
      detached.dispose();
    }
  });

  it("openDiff：把仓库根和左右两边原样交给界面", async () => {
    const calls: unknown[][] = [];
    const ui: HandlerUi = {
      ...NO_UI,
      openDiff: async (...args) => {
        calls.push(args);
      },
    };
    const left: DiffSide = { kind: DiffSideKind.Missing, path: "a.ts" };
    const right: DiffSide = { kind: DiffSideKind.Revision, hash: "f".repeat(40), path: "a.ts" };
    const result = await createHandlers(repository, ui).openDiff({
      repo: repository.location.root,
      left,
      right,
      mode: DiffOpenMode.Open,
    });
    expect(result).toBeNull();
    expect(calls).toEqual([[repository.location.root, left, right, DiffOpenMode.Open]]);
  });

  it("经 Router 走一遍：请求进去，Ok 响应出来", async () => {
    // 与上面三条的区别：这条经过了**边界校验**与**信封**，
    // 也就是真实运行时 webview 那一侧看到的东西。
    const sent: unknown[] = [];
    const transport: Transport = { post: (m) => void sent.push(m) };
    const router = new Router(transport, createHandlers(repository, NO_UI));

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
    const router = new Router(
      { post: (m) => void sent.push(m) },
      createHandlers(repository, NO_UI),
    );

    router.receive({ kind: MessageKind.Ready, generation: "g1" });
    router.receive({
      kind: MessageKind.Request,
      generation: "g1",
      id: 2,
      command: "getCommitFiles",
      // 不存在的 hash：git 会失败，分类后由 router 转成错误响应。
      params: { repo: repository.location.root, hash: "0".repeat(40) },
    });

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ id: 2, result: ResponseKind.Error });
  });
});

describe("闭环：仓库变了 → 广播到面板", () => {
  it("git 路径变化 → 分域 → 广播，只说哪些域过期，不带数据", async () => {
    // 链路：watcher（vscode，唯一没覆盖的一环）→ repo.notifyGitPath
    //   → 分类/防抖 → onDidChange → router.broadcast → transport
    const repository = new Repository(await getRepositoryLocation.execute(cli, fixtures.base), cli);
    const sent: unknown[] = [];
    const router = new Router(
      { post: (m) => void sent.push(m) },
      createHandlers(repository, NO_UI),
    );
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
    const router = new Router(
      { post: (m) => void sent.push(m) },
      createHandlers(repository, NO_UI),
    );
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
    const router = new Router(
      { post: (m) => void sent.push(m) },
      createHandlers(repository, NO_UI),
    );
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

describe("handlers.commit", () => {
  afterAll(cleanupTempRepos);

  it("改名：只勾新路径，旧路径的删除也一起提交，不剩下一个 D", async () => {
    const path = makeTempRepo("commit-rename");
    git(path, ["mv", "f1", "renamed"]);
    const repository = new Repository(plainLocation(path), cli);
    await createHandlers(repository, NO_UI).commit({
      repo: path,
      message: "rename",
      paths: ["renamed"],
    });
    repository.dispose();
    expect(git(path, ["status", "--porcelain"]).trim()).toBe("");
  });
});

describe("handlers.rollback", () => {
  afterAll(cleanupTempRepos);

  it("未跟踪文件不动；确认后已跟踪的恢复（改名带上旧路径）", async () => {
    const path = makeTempRepo("rollback-handler");
    git(path, ["mv", "f1", "renamed"]);
    writeFileSync(join(path, "untracked.txt"), "keep\n");
    const asked: (readonly string[])[] = [];
    const repository = new Repository(plainLocation(path), cli);
    await createHandlers(repository, {
      ...NO_UI,
      confirmRollback: async (paths) => {
        asked.push(paths);
        return true;
      },
    }).rollback({ repo: path, paths: ["renamed", "untracked.txt"] });
    repository.dispose();
    expect(asked).toEqual([["renamed"]]);
    expect(git(path, ["status", "--porcelain"]).trim()).toBe("?? untracked.txt");
  });

  it("取消确认：什么都不做", async () => {
    const path = makeTempRepo("rollback-cancel");
    writeFileSync(join(path, "f1"), "changed\n");
    const repository = new Repository(plainLocation(path), cli);
    await createHandlers(repository, { ...NO_UI, confirmRollback: async () => false }).rollback({
      repo: path,
      paths: ["f1"],
    });
    repository.dispose();
    expect(git(path, ["status", "--porcelain"]).trim()).toBe("M f1");
  });
});

describe("handlers.pull", () => {
  afterAll(cleanupTempRepos);
  const pull = async (path: string, branch: string) => {
    const repository = new Repository(plainLocation(path), cli);
    try {
      await createHandlers(repository, NO_UI).pull({ repo: path, branch });
    } finally {
      repository.dispose();
    }
  };

  it("当前分支与非当前分支都能快进到远程", async () => {
    const { remote, repo } = makeTrackingRepos();
    git(remote, ["commit", "-q", "--allow-empty", "-m", "remote"]);
    await pull(repo, "main");
    await pull(repo, "other");
    const tip = git(remote, ["rev-parse", "main"]);
    expect(git(repo, ["rev-parse", "main"])).toBe(tip);
    expect(git(repo, ["rev-parse", "other"])).toBe(tip);
  });

  it("没有上游：给一句说明，不跑 git", async () => {
    const { repo } = makeTrackingRepos();
    git(repo, ["branch", "-q", "lonely"]);
    await expect(pull(repo, "lonely")).rejects.toThrow(
      "lonely has no upstream branch. Push it first.",
    );
  });

  it("两边各有新提交：给一句说明，git 原文留在 detail", async () => {
    const { remote, repo } = makeTrackingRepos();
    git(remote, ["commit", "-q", "--allow-empty", "-m", "remote"]);
    git(repo, ["commit", "-q", "--allow-empty", "-m", "local"]);
    const error = await pull(repo, "main").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UserFacingError);
    expect(error instanceof UserFacingError && error.message).toBe(
      "Cannot fast-forward main: it and origin/main have both changed. Merging is not supported yet.",
    );
    expect(error instanceof UserFacingError && error.detail).toContain("fast-forward");
  });
});
