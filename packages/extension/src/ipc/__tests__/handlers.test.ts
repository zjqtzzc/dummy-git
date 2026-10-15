import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  DialogKind,
  DiffOpenMode,
  type DiffSide,
  DiffSideKind,
  GitDomain,
  IndexStage,
  MessageKind,
  OperationKind,
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
  stashConflict,
} from "../../__tests__/support.js";
import { Repository } from "../../core/repository.js";
import { getRepositoryLocation } from "../../git/commands/index.js";
import type { MergeSides } from "../../vscode/mergeEditor.js";
import { createHandlers, type HandlerUi, type PickItem } from "../handlers.js";
import type { HandlerMap } from "../router.js";
import { UserFacingError } from "../userFacingError.js";

/** 不涉及界面的测试用它：真调到就说明测错了东西。 */
const NO_UI: HandlerUi = {
  confirmRollback: () => Promise.reject(new Error("测试里不该弹确认")),
  withProgress: (_title, task) => task(),
  askBranchName: () => Promise.reject(new Error("测试里不该弹输入框")),
  confirm: () => Promise.reject(new Error("测试里不该弹确认")),
  notifyChoice: () => Promise.reject(new Error("测试里不该弹通知")),
  choose: () => Promise.reject(new Error("测试里不该弹选择")),
  notify: () => undefined,
  pick: () => Promise.reject(new Error("测试里不该弹选择框")),
  openDialog: () => {
    throw new Error("测试里不该开对话框");
  },
  closeDialog: () => undefined,
  copyText: () => Promise.reject(new Error("测试里不该写剪贴板")),
  openMergeEditor: () => Promise.reject(new Error("测试里不该打开合并编辑器")),
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

describe("handlers.update", () => {
  afterAll(cleanupTempRepos);
  const update = async (path: string, branch: string) => {
    const repository = new Repository(plainLocation(path), cli);
    try {
      await createHandlers(repository, NO_UI).update({ repo: path, branch });
    } finally {
      repository.dispose();
    }
  };

  /** 分叉后选一个按钮。`undefined` 是关掉通知。返回问过的话和进度出口说过的话。 */
  const updateDiverged = async (path: string, branch: string, choice: number | undefined) => {
    const repository = new Repository(plainLocation(path), cli);
    const asked: string[] = [];
    const said: string[] = [];
    try {
      await createHandlers(repository, {
        ...NO_UI,
        notifyChoice: async (message, actions) => {
          asked.push(`${message} [${actions.join(" / ")}]`);
          return choice;
        },
        withProgress: async (title, task, done) => {
          said.push(title);
          const value = await task();
          const message = done(value);
          if (message !== "") said.push(message);
          return value;
        },
      }).update({ repo: path, branch });
      return { asked, said };
    } finally {
      repository.dispose();
    }
  };

  /**
   * 本地 `branch` 与 origin/main 各多一个文件。
   * `other` 时先在那条上提交，再切回 main，让它不是当前分支。
   */
  const diverge = (remote: string, repo: string, branch: "main" | "other"): void => {
    if (branch === "other") {
      git(repo, ["switch", "-q", "other"]);
      writeFileSync(join(repo, "other.txt"), "other\n");
      git(repo, ["add", "other.txt"]);
      git(repo, ["commit", "-qm", "other"]);
      git(repo, ["switch", "-q", "main"]);
    } else {
      writeFileSync(join(repo, "local.txt"), "local\n");
      git(repo, ["add", "local.txt"]);
      git(repo, ["commit", "-qm", "local"]);
    }
    writeFileSync(join(remote, "remote.txt"), "remote\n");
    git(remote, ["add", "remote.txt"]);
    git(remote, ["commit", "-qm", "remote"]);
  };

  it("当前分支与非当前分支都能快进到远程", async () => {
    const { remote, repo } = makeTrackingRepos();
    git(remote, ["commit", "-q", "--allow-empty", "-m", "remote"]);
    await update(repo, "main");
    await update(repo, "other");
    const tip = git(remote, ["rev-parse", "main"]);
    expect(git(repo, ["rev-parse", "main"])).toBe(tip);
    expect(git(repo, ["rev-parse", "other"])).toBe(tip);
  });

  it("没有上游：给一句说明，不跑 git", async () => {
    const { repo } = makeTrackingRepos();
    git(repo, ["branch", "-q", "lonely"]);
    await expect(update(repo, "lonely")).rejects.toThrow(
      "lonely has no upstream branch. Push it first.",
    );
  });

  it("关掉通知：本地分支不动，远程记录已经是新的", async () => {
    const { remote, repo } = makeTrackingRepos();
    diverge(remote, repo, "main");
    const local = git(repo, ["rev-parse", "main"]);
    const { asked, said } = await updateDiverged(repo, "main", undefined);
    expect(asked).toEqual(["main and origin/main have diverged. [Rebase / Merge]"]);
    expect(said).toEqual(["Updating main…"]);
    expect(git(repo, ["rev-parse", "main"])).toBe(local);
    expect(git(repo, ["rev-parse", "origin/main"])).toBe(git(remote, ["rev-parse", "main"]));
  });

  it("选 Rebase：当前分支接到远程之上，未提交的改动还在", async () => {
    const { remote, repo } = makeTrackingRepos();
    diverge(remote, repo, "main");
    writeFileSync(join(repo, "f1"), "dirty\n");
    const { said } = await updateDiverged(repo, "main", 0);
    expect(said).toEqual([
      "Updating main…",
      "Rebasing onto origin/main…",
      "Rebased onto origin/main",
    ]);
    expect(git(repo, ["log", "-1", "--format=%s"]).trim()).toBe("local");
    git(repo, ["merge-base", "--is-ancestor", git(remote, ["rev-parse", "main"]).trim(), "HEAD"]);
    expect(readFileSync(join(repo, "remote.txt"), "utf8")).toBe("remote\n");
    expect(readFileSync(join(repo, "local.txt"), "utf8")).toBe("local\n");
    expect(readFileSync(join(repo, "f1"), "utf8")).toBe("dirty\n");
    expect(git(repo, ["status", "--porcelain"]).trimEnd()).toBe(" M f1");
  });

  it("选 Merge：合成合并提交，说明用远程分支的显示名", async () => {
    const { remote, repo } = makeTrackingRepos();
    diverge(remote, repo, "main");
    const { said } = await updateDiverged(repo, "main", 1);
    expect(said).toEqual(["Updating main…", "Merging origin/main…", "Merged origin/main"]);
    expect(git(repo, ["log", "-1", "--format=%s"]).trim()).toBe(
      "Merge remote-tracking branch 'origin/main'",
    );
    expect(readFileSync(join(repo, "remote.txt"), "utf8")).toBe("remote\n");
    expect(readFileSync(join(repo, "local.txt"), "utf8")).toBe("local\n");
  });

  it("选 Merge 且文件撞上：停在冲突，不当成失败", async () => {
    const { remote, repo } = makeTrackingRepos();
    writeFileSync(join(remote, "f1"), "remote\n");
    git(remote, ["add", "f1"]);
    git(remote, ["commit", "-qm", "remote"]);
    writeFileSync(join(repo, "f1"), "local\n");
    git(repo, ["add", "f1"]);
    git(repo, ["commit", "-qm", "local"]);
    const { said } = await updateDiverged(repo, "main", 1);
    expect(said).toEqual(["Updating main…", "Merging origin/main…", "Stopped for conflicts"]);
    expect(existsSync(join(repo, ".git", "MERGE_HEAD"))).toBe(true);
  });

  it("非当前分支选 Rebase：先切到那条，原来的当前分支不动", async () => {
    const { remote, repo } = makeTrackingRepos();
    diverge(remote, repo, "other");
    const main = git(repo, ["rev-parse", "main"]);
    const { said } = await updateDiverged(repo, "other", 0);
    expect(said).toEqual([
      "Updating other…",
      "Rebasing onto origin/main…",
      "Rebased onto origin/main",
    ]);
    expect(git(repo, ["branch", "--show-current"]).trim()).toBe("other");
    expect(git(repo, ["rev-parse", "main"])).toBe(main);
    expect(git(repo, ["log", "-1", "--format=%s"]).trim()).toBe("other");
    expect(readFileSync(join(repo, "other.txt"), "utf8")).toBe("other\n");
    expect(readFileSync(join(repo, "remote.txt"), "utf8")).toBe("remote\n");
  });

  it("非当前分支选 Merge：先切过去再合并", async () => {
    const { remote, repo } = makeTrackingRepos();
    diverge(remote, repo, "other");
    const main = git(repo, ["rev-parse", "main"]);
    const { said } = await updateDiverged(repo, "other", 1);
    expect(said).toEqual([
      "Updating other…",
      "Checking out other…",
      "Switched to branch 'other'",
      "Merging origin/main…",
      "Merged origin/main",
    ]);
    expect(git(repo, ["branch", "--show-current"]).trim()).toBe("other");
    expect(git(repo, ["rev-parse", "main"])).toBe(main);
    expect(git(repo, ["log", "-1", "--format=%s"]).trim()).toBe(
      "Merge remote-tracking branch 'origin/main'",
    );
    expect(readFileSync(join(repo, "other.txt"), "utf8")).toBe("other\n");
    expect(readFileSync(join(repo, "remote.txt"), "utf8")).toBe("remote\n");
  });

  it("非当前分支关掉通知：那条分支不动，远程记录已经是新的", async () => {
    const { remote, repo } = makeTrackingRepos();
    diverge(remote, repo, "other");
    const other = git(repo, ["rev-parse", "other"]);
    const { asked, said } = await updateDiverged(repo, "other", undefined);
    expect(asked).toEqual(["other and origin/main have diverged. [Rebase / Merge]"]);
    expect(said).toEqual(["Updating other…"]);
    expect(git(repo, ["branch", "--show-current"]).trim()).toBe("main");
    expect(git(repo, ["rev-parse", "other"])).toBe(other);
    expect(git(repo, ["rev-parse", "origin/main"])).toBe(git(remote, ["rev-parse", "main"]));
  });
});

describe("handlers.getPushTarget / push", () => {
  afterAll(cleanupTempRepos);
  const withHandlers = async <T>(path: string, run: (handlers: HandlerMap) => Promise<T>) => {
    const repository = new Repository(plainLocation(path), cli);
    try {
      return await run(createHandlers(repository, NO_UI));
    } finally {
      repository.dispose();
    }
  };
  const repos = () => {
    const { remote, repo } = makeTrackingRepos();
    git(remote, ["config", "receive.denyCurrentBranch", "ignore"]);
    return { remote, repo };
  };

  it("没有上游的新分支：默认目标是唯一远程的同名分支；推过去并设为上游", async () => {
    const { remote, repo } = repos();
    git(repo, ["branch", "-q", "feat"]);
    await withHandlers(repo, async (handlers) => {
      const { remotes, ...target } = await handlers.getPushTarget({ repo, branch: "feat" });
      expect({ remotes, ...target }).toEqual({
        remotes: ["origin"],
        remote: "origin",
        remoteBranch: "feat",
      });
      await handlers.push({ repo, branch: "feat", ...target, force: false });
    });
    expect(git(remote, ["rev-parse", "feat"])).toBe(git(repo, ["rev-parse", "feat"]));
    expect(git(repo, ["rev-parse", "--abbrev-ref", "feat@{upstream}"]).trim()).toBe("origin/feat");
  });

  it("有上游时推到另一个名字：上游不变", async () => {
    const { remote, repo } = repos();
    await withHandlers(repo, (handlers) =>
      handlers.push({ repo, branch: "main", remote: "origin", remoteBranch: "copy", force: false }),
    );
    expect(git(remote, ["rev-parse", "copy"])).toBe(git(repo, ["rev-parse", "main"]));
    expect(git(repo, ["rev-parse", "--abbrev-ref", "main@{upstream}"]).trim()).toBe("origin/main");
  });

  it("一个远程都没有：在对话框里定义远程，先加远程再推，并设为上游", async () => {
    const { remote, repo } = repos();
    git(repo, ["remote", "remove", "origin"]);
    await withHandlers(repo, async (handlers) => {
      const { remotes, ...target } = await handlers.getPushTarget({ repo, branch: "main" });
      expect({ remotes, ...target }).toEqual({
        remotes: [],
        remote: "origin",
        remoteBranch: "main",
      });
      await handlers.push({ repo, branch: "main", ...target, force: false, remoteUrl: remote });
    });
    expect(git(repo, ["remote", "get-url", "origin"]).trim()).toBe(remote);
    expect(git(repo, ["rev-parse", "--abbrev-ref", "main@{upstream}"]).trim()).toBe("origin/main");
  });

  it("被拒绝：给一句说明，git 原文留在 detail", async () => {
    const { remote, repo } = repos();
    git(remote, ["commit", "-q", "--allow-empty", "-m", "remote"]);
    git(repo, ["commit", "-q", "--allow-empty", "-m", "local"]);
    const error = await withHandlers(repo, (handlers) =>
      handlers.push({
        repo,
        branch: "main",
        remote: "origin",
        remoteBranch: "main",
        force: false,
      }),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UserFacingError);
    expect(error instanceof UserFacingError && error.message).toBe(
      "Push rejected: origin/main has commits that main doesn't have. Update it first.",
    );
    expect(error instanceof UserFacingError && error.detail).toContain("[rejected]");
  });
});

describe("handlers.push：force", () => {
  afterAll(cleanupTempRepos);

  /** 远程多一条本地没有的提交（已 fetch），本地另有一条：普通推送会被拒。 */
  function diverged(): { remote: string; repo: string } {
    const { remote, repo } = makeTrackingRepos();
    git(remote, ["config", "receive.denyCurrentBranch", "ignore"]);
    git(remote, ["commit", "-q", "--allow-empty", "-m", "remote"]);
    git(repo, ["fetch", "-q"]);
    git(repo, ["commit", "-q", "--allow-empty", "-m", "local"]);
    return { remote, repo };
  }

  const forcePush = async (path: string, sure: boolean) => {
    const asked: string[] = [];
    const repository = new Repository(plainLocation(path), cli);
    const ui: HandlerUi = {
      ...NO_UI,
      confirm: async (message) => {
        asked.push(message);
        return sure;
      },
    };
    try {
      await createHandlers(repository, ui).push({
        repo: path,
        branch: "main",
        remote: "origin",
        remoteBranch: "main",
        force: true,
      });
    } finally {
      repository.dispose();
    }
    return asked;
  };

  it("先确认；确认了就覆盖远程", async () => {
    const { remote, repo } = diverged();
    expect(await forcePush(repo, true)).toEqual([
      "Force push to origin/main? It may overwrite commits at the remote.",
    ]);
    expect(git(remote, ["rev-parse", "main"])).toBe(git(repo, ["rev-parse", "main"]));
  });

  it("取消：远程不动", async () => {
    const { remote, repo } = diverged();
    const before = git(remote, ["rev-parse", "main"]);
    await forcePush(repo, false);
    expect(git(remote, ["rev-parse", "main"])).toBe(before);
  });
});

describe("handlers.checkout", () => {
  afterAll(cleanupTempRepos);

  it("切到选中的本地分支", async () => {
    const path = makeTempRepo("checkout-handler");
    git(path, ["branch", "-q", "feat"]);
    const repository = new Repository(plainLocation(path), cli);
    await createHandlers(repository, NO_UI).checkout({ repo: path, branch: "feat" });
    repository.dispose();
    expect(git(path, ["branch", "--show-current"]).trim()).toBe("feat");
  });
});

describe("handlers.checkoutRemote", () => {
  afterAll(cleanupTempRepos);
  /** 检出 `origin/<branch>`，返回进度出口最后显示的那句。 */
  const checkoutRemote = async (path: string, branch: string): Promise<string> => {
    const repository = new Repository(plainLocation(path), cli);
    let said = "";
    const ui: HandlerUi = {
      ...NO_UI,
      withProgress: async (_title, task, done) => {
        const value = await task();
        said = done(value);
        return value;
      },
    };
    try {
      await createHandlers(repository, ui).checkoutRemote({ repo: path, remote: "origin", branch });
    } finally {
      repository.dispose();
    }
    return said;
  };
  const current = (repo: string) => git(repo, ["branch", "--show-current"]).trim();
  const tip = (repo: string, ref: string) => git(repo, ["rev-parse", ref]).trim();

  it("本地没有同名分支：建一个跟踪它的并切过去", async () => {
    const { remote, repo } = makeTrackingRepos();
    git(remote, ["branch", "-q", "feat"]);
    git(repo, ["fetch", "-q", "origin"]);
    expect(await checkoutRemote(repo, "feat")).toBe("Switched to a new branch 'feat'");
    expect(current(repo)).toBe("feat");
    expect(git(repo, ["rev-parse", "--abbrev-ref", "feat@{u}"]).trim()).toBe("origin/feat");
  });

  it("本地同名分支跟踪它且落后：切过去并快进", async () => {
    const { remote, repo } = makeTrackingRepos();
    git(remote, ["commit", "-q", "--allow-empty", "-m", "remote"]);
    git(repo, ["fetch", "-q", "origin"]);
    git(repo, ["switch", "-q", "other"]);
    expect(await checkoutRemote(repo, "main")).toBe("Switched to branch 'main'");
    expect(current(repo)).toBe("main");
    expect(tip(repo, "main")).toBe(tip(remote, "main"));
  });

  it("本地同名分支跟踪它且领先：只切过去", async () => {
    const { repo } = makeTrackingRepos();
    git(repo, ["commit", "-q", "--allow-empty", "-m", "local"]);
    const before = tip(repo, "main");
    git(repo, ["switch", "-q", "other"]);
    expect(await checkoutRemote(repo, "main")).toBe("Switched to branch 'main'");
    expect(current(repo)).toBe("main");
    expect(tip(repo, "main")).toBe(before);
  });

  it("本地同名分支跟踪它但已分叉：切过去、不动它，提醒分叉", async () => {
    const { remote, repo } = makeTrackingRepos();
    git(remote, ["commit", "-q", "--allow-empty", "-m", "remote"]);
    git(repo, ["fetch", "-q", "origin"]);
    git(repo, ["commit", "-q", "--allow-empty", "-m", "local"]);
    const before = tip(repo, "main");
    git(repo, ["switch", "-q", "other"]);
    expect(await checkoutRemote(repo, "main")).toBe("main and origin/main have diverged");
    expect(current(repo)).toBe("main");
    expect(tip(repo, "main")).toBe(before);
  });

  it("本地同名分支不跟踪它：不切，说明原因", async () => {
    const { remote, repo } = makeTrackingRepos();
    git(remote, ["branch", "-q", "feat"]);
    git(repo, ["fetch", "-q", "origin"]);
    git(repo, ["branch", "-q", "feat"]);
    await expect(checkoutRemote(repo, "feat")).rejects.toThrow(
      "A local branch named feat already exists and doesn't track origin/feat.",
    );
    expect(current(repo)).toBe("main");
  });
});

describe("handlers.newBranch", () => {
  afterAll(cleanupTempRepos);
  /**
   * 从 `start` 建分支，输入框回答 `answer`。输入框开着时把 `probes` 逐个喂给校验函数，
   * 返回输入框的标题与每个探针的校验结果。
   */
  const newBranch = async (
    path: string,
    start: string,
    startName: string,
    answer: string | undefined,
    probes: readonly string[] = [],
  ) => {
    const repository = new Repository(plainLocation(path), cli);
    let title = "";
    const problems: (string | undefined)[] = [];
    const ui: HandlerUi = {
      ...NO_UI,
      askBranchName: async (asked, _value, validate) => {
        title = asked;
        for (const probe of probes) problems.push(await validate(probe));
        return answer;
      },
    };
    try {
      await createHandlers(repository, ui).newBranch({ repo: path, start, startName });
      return { title, problems };
    } finally {
      repository.dispose();
    }
  };

  it("从远程分支建：切过去，不跟踪起点", async () => {
    const { remote, repo } = makeTrackingRepos();
    git(remote, ["commit", "-q", "--allow-empty", "-m", "remote"]);
    git(repo, ["fetch", "-q", "origin"]);
    const { title } = await newBranch(repo, "refs/remotes/origin/main", "origin/main", "fix");
    expect(title).toBe("New branch from origin/main");
    expect(git(repo, ["branch", "--show-current"]).trim()).toBe("fix");
    expect(git(repo, ["rev-parse", "fix"])).toBe(git(remote, ["rev-parse", "main"]));
    expect(() => git(repo, ["rev-parse", "--abbrev-ref", "fix@{u}"])).toThrow();
  });

  it("取消或空着确定：什么都不做", async () => {
    const repo = makeTempRepo("new-branch-cancel");
    await newBranch(repo, "refs/heads/main", "main", undefined);
    await newBranch(repo, "refs/heads/main", "main", "");
    expect(git(repo, ["branch", "--format=%(refname:short)"]).trim()).toBe("main");
  });

  it("校验：不合法、重名给出问题；合法与空着不给", async () => {
    const repo = makeTempRepo("new-branch-validate");
    git(repo, ["branch", "-q", "feat"]);
    const { problems } = await newBranch(repo, "refs/heads/main", "main", undefined, [
      "a b",
      "feat",
      "feat-2",
      "",
    ]);
    expect(problems).toEqual([
      "'a b' is not a valid branch name.",
      "A branch named 'feat' already exists.",
      undefined,
      undefined,
    ]);
  });
});

describe("handlers.renameBranch", () => {
  afterAll(cleanupTempRepos);
  /** 改 `branch` 的名字，输入框回答 `answer`；返回输入框收到的预填值与每个探针的校验结果。 */
  const rename = async (
    path: string,
    branch: string,
    answer: string | undefined,
    probes: readonly string[] = [],
  ) => {
    const repository = new Repository(plainLocation(path), cli);
    let prefilled = "";
    const problems: (string | undefined)[] = [];
    const ui: HandlerUi = {
      ...NO_UI,
      askBranchName: async (_title, value, validate) => {
        prefilled = value;
        for (const probe of probes) problems.push(await validate(probe));
        return answer;
      },
    };
    try {
      await createHandlers(repository, ui).renameBranch({ repo: path, branch });
      return { prefilled, problems };
    } finally {
      repository.dispose();
    }
  };
  const branches = (repo: string) =>
    git(repo, ["branch", "--format=%(refname:short)"]).trim().split("\n");

  it("改当前分支：仍是当前分支，上游带过去", async () => {
    const { repo } = makeTrackingRepos();
    const { prefilled } = await rename(repo, "main", "trunk");
    expect(prefilled).toBe("main");
    expect(git(repo, ["branch", "--show-current"]).trim()).toBe("trunk");
    expect(git(repo, ["rev-parse", "--abbrev-ref", "trunk@{u}"]).trim()).toBe("origin/main");
  });

  it("没改、空着、取消：什么都不做", async () => {
    const repo = makeTempRepo("rename-unchanged");
    await rename(repo, "main", "main");
    await rename(repo, "main", "");
    await rename(repo, "main", undefined);
    expect(branches(repo)).toEqual(["main"]);
  });

  it("校验：旧名不算重名，别的分支算", async () => {
    const repo = makeTempRepo("rename-validate");
    git(repo, ["branch", "-q", "feat"]);
    const { problems } = await rename(repo, "main", undefined, ["main", "feat"]);
    expect(problems).toEqual([undefined, "A branch named 'feat' already exists."]);
  });
});

describe("handlers.deleteBranch / deleteRemoteBranch", () => {
  afterAll(cleanupTempRepos);
  /** 跑一次删除，确认框回答 `sure`；返回问了什么、状态栏说了什么。 */
  const run = async (
    path: string,
    act: (handlers: ReturnType<typeof createHandlers>) => Promise<unknown>,
    sure: boolean,
  ) => {
    const repository = new Repository(plainLocation(path), cli);
    const asked: string[] = [];
    const said: string[] = [];
    const ui: HandlerUi = {
      ...NO_UI,
      confirm: async (message) => {
        asked.push(message);
        return sure;
      },
      notify: (message) => said.push(message),
      withProgress: async (_title, task, done) => {
        const value = await task();
        said.push(done(value));
        return value;
      },
    };
    try {
      await act(createHandlers(repository, ui));
      return { asked, said };
    } finally {
      repository.dispose();
    }
  };
  const branches = (repo: string, args: readonly string[] = []) =>
    git(repo, ["branch", ...args, "--format=%(refname:short)"])
      .trim()
      .split("\n");

  it("已合并：直接删，不问，状态栏是 git 那句", async () => {
    const repo = makeTempRepo("delete-merged");
    git(repo, ["branch", "-q", "feat"]);
    const { asked, said } = await run(repo, (h) => h.deleteBranch({ repo, branch: "feat" }), false);
    expect(asked).toEqual([]);
    expect(said[0]).toMatch(/^Deleted branch feat \(was [0-9a-f]+\)\.$/);
    expect(branches(repo)).toEqual(["main"]);
  });

  it("没合并：问一次，确认后强删", async () => {
    const repo = makeTempRepo("delete-unmerged");
    git(repo, ["switch", "-q", "-c", "feat"]);
    git(repo, ["commit", "-q", "--allow-empty", "-m", "only here"]);
    git(repo, ["switch", "-q", "main"]);
    const { asked, said } = await run(repo, (h) => h.deleteBranch({ repo, branch: "feat" }), true);
    expect(asked).toEqual(["feat has commits that are not merged anywhere. Delete it anyway?"]);
    expect(said[0]).toMatch(/^Deleted branch feat \(was [0-9a-f]+\)\.$/);
    expect(branches(repo)).toEqual(["main"]);
  });

  it("没合并、取消：留着", async () => {
    const repo = makeTempRepo("delete-unmerged-cancel");
    git(repo, ["switch", "-q", "-c", "feat"]);
    git(repo, ["commit", "-q", "--allow-empty", "-m", "only here"]);
    git(repo, ["switch", "-q", "main"]);
    const { said } = await run(repo, (h) => h.deleteBranch({ repo, branch: "feat" }), false);
    expect(said).toEqual([]);
    expect(branches(repo)).toEqual(["feat", "main"]);
  });

  it("远程分支：确认后删远程的，本地同名分支不动", async () => {
    const { remote, repo } = makeTrackingRepos();
    git(remote, ["branch", "-q", "feat"]);
    git(repo, ["fetch", "-q", "origin"]);
    git(repo, ["branch", "-q", "feat"]);
    const { asked, said } = await run(
      repo,
      (h) => h.deleteRemoteBranch({ repo, remote: "origin", branch: "feat" }),
      true,
    );
    expect(asked).toEqual([
      "Delete feat on origin? This removes it for everyone using the remote.",
    ]);
    expect(said).toEqual(["Deleted origin/feat"]);
    expect(branches(remote)).toEqual(["main"]);
    expect(branches(repo, ["-r"])).toEqual(["origin/main"]);
    expect(branches(repo)).toContain("feat");
  });

  it("远程分支、取消：远程不动", async () => {
    const { remote, repo } = makeTrackingRepos();
    git(remote, ["branch", "-q", "feat"]);
    git(repo, ["fetch", "-q", "origin"]);
    await run(repo, (h) => h.deleteRemoteBranch({ repo, remote: "origin", branch: "feat" }), false);
    expect(branches(remote)).toEqual(["feat", "main"]);
  });
});

describe("handlers.stash", () => {
  afterAll(cleanupTempRepos);
  const stash = async (path: string, paths: readonly string[]) => {
    const repository = new Repository(plainLocation(path), cli);
    let said = "";
    const ui: HandlerUi = {
      ...NO_UI,
      withProgress: async (_title, task, done) => {
        const value = await task();
        said = done(value);
        return value;
      },
    };
    try {
      await createHandlers(repository, ui).stash({ repo: path, paths });
      return said;
    } finally {
      repository.dispose();
    }
  };
  const status = (repo: string) => git(repo, ["status", "--porcelain"]).trimEnd().split("\n");
  const stashes = (repo: string) => git(repo, ["stash", "list"]).trim().split("\n").filter(Boolean);

  /** 改名 a → a2、`git rm` 掉 b、新建未跟踪的 u、改了 keep。 */
  const scene = (name: string) => {
    const repo = makeTempRepo(name);
    for (const file of ["a", "b", "keep"]) writeFileSync(join(repo, file), `${file}\n`);
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-qm", "files"]);
    git(repo, ["mv", "a", "a2"]);
    git(repo, ["rm", "-q", "b"]);
    writeFileSync(join(repo, "u"), "new\n");
    writeFileSync(join(repo, "keep"), "changed\n");
    return repo;
  };

  it("存勾选的：改名、暂存的删除、未跟踪都存走，没勾的留下", async () => {
    const repo = scene("stash-selected");
    const said = await stash(repo, ["a2", "b", "u"]);
    expect(said).toMatch(/^Saved working directory and index state WIP on main: /);
    expect(stashes(repo)).toHaveLength(1);
    expect(status(repo)).toEqual([" M keep"]);
    git(repo, ["stash", "apply", "-q"]);
    expect(status(repo).sort()).toEqual([" D a", " D b", " M keep", "?? u", "A  a2"].sort());
  });

  it("什么都没勾：存全部改动，含未跟踪", async () => {
    const repo = scene("stash-all");
    await stash(repo, []);
    expect(stashes(repo)).toHaveLength(1);
    expect(status(repo)).toEqual([""]);
  });
});

describe("handlers.applyStash / popStash / dropStash", () => {
  afterAll(cleanupTempRepos);
  /** 两条 stash：较早的改了 f1，较新的新建了 f2（未跟踪）。返回两条的 hash。 */
  const scene = (name: string) => {
    const repo = makeTempRepo(name);
    writeFileSync(join(repo, "f1"), "older\n");
    git(repo, ["stash", "push", "-q"]);
    writeFileSync(join(repo, "f2"), "newer\n");
    git(repo, ["stash", "push", "-q", "-u"]);
    const hash = (ref: string) => git(repo, ["rev-parse", ref]).trim();
    return { repo, newer: hash("stash@{0}"), older: hash("stash@{1}") };
  };
  const stashes = (repo: string) =>
    git(repo, ["stash", "list", "--format=%H"]).trim().split("\n").filter(Boolean);
  const act = async (
    repo: string,
    run: (h: ReturnType<typeof createHandlers>) => Promise<unknown>,
    sure = true,
  ) => {
    const repository = new Repository(plainLocation(repo), cli);
    const said: string[] = [];
    const ui: HandlerUi = {
      ...NO_UI,
      confirm: async () => sure,
      notify: (message) => said.push(message),
      withProgress: async (_title, task, done) => {
        const value = await task();
        said.push(done(value));
        return value;
      },
    };
    try {
      await run(createHandlers(repository, ui));
      return said;
    } finally {
      repository.dispose();
    }
  };

  it("Apply：取回工作区，stash 保留", async () => {
    const { repo, older } = scene("stash-apply");
    const said = await act(repo, (h) => h.applyStash({ repo, hash: older }));
    expect(said).toEqual([expect.stringMatching(/^Applied WIP on main: /)]);
    expect(git(repo, ["status", "--porcelain"]).trim()).toBe("M f1");
    expect(stashes(repo)).toHaveLength(2);
  });

  it("Pop 较早的那条：取回它、只删它", async () => {
    const { repo, newer, older } = scene("stash-pop");
    await act(repo, (h) => h.popStash({ repo, hash: older }));
    expect(git(repo, ["status", "--porcelain"]).trim()).toBe("M f1");
    expect(stashes(repo)).toEqual([newer]);
  });

  it("Delete 较早的那条：确认后只删它，状态栏是 git 那句", async () => {
    const { repo, newer, older } = scene("stash-drop");
    const said = await act(repo, (h) => h.dropStash({ repo, hash: older }));
    expect(said).toEqual([`Dropped stash@{1} (${older})`]);
    expect(stashes(repo)).toEqual([newer]);
  });

  it("Delete 取消：留着", async () => {
    const { repo } = scene("stash-drop-cancel");
    const [, older] = stashes(repo);
    await act(repo, (h) => h.dropStash({ repo, hash: older ?? "" }), false);
    expect(stashes(repo)).toHaveLength(2);
  });
});

describe("handlers.pick", () => {
  afterAll(cleanupTempRepos);
  const pick = async (answer: number | undefined) => {
    const path = makeTempRepo("pick");
    const repository = new Repository(plainLocation(path), cli);
    const asked: { title: string; items: readonly PickItem[] }[] = [];
    const ui: HandlerUi = {
      ...NO_UI,
      pick: async (title, items) => {
        asked.push({ title, items });
        return answer;
      },
    };
    try {
      const result = await createHandlers(repository, ui).pick({ title: "T", items: ["a", "b"] });
      return { result, asked };
    } finally {
      repository.dispose();
    }
  };

  it("把标题与选项交给选择框，返回选中的序号；取消是 null", async () => {
    expect(await pick(1)).toEqual({
      result: 1,
      asked: [{ title: "T", items: [{ label: "a" }, { label: "b" }] }],
    });
    expect((await pick(undefined)).result).toBeNull();
  });
});

describe("handlers.pickAuthor", () => {
  afterAll(cleanupTempRepos);
  const pickAuthor = async (path: string, answer: number | undefined) => {
    const repository = new Repository(plainLocation(path), cli);
    let shown: readonly PickItem[] = [];
    const ui: HandlerUi = {
      ...NO_UI,
      pick: async (_title, items) => {
        shown = items;
        return answer;
      },
    };
    try {
      const hashes = git(path, ["log", "--format=%H"]).trim().split("\n");
      const picked = await createHandlers(repository, ui).pickAuthor({ repo: path, hashes });
      return { shown, picked };
    } finally {
      repository.dispose();
    }
  };
  const scene = () => {
    const repo = makeTempRepo("pick-author");
    for (let i = 0; i < 2; i++) {
      git(repo, [
        "-c",
        "user.name=Ann",
        "-c",
        "user.email=",
        "commit",
        "-q",
        "--allow-empty",
        "-m",
        "a",
      ]);
    }
    return repo;
  };

  it("第一项是 Me，下面是作者按提交数从多到少；邮箱为空的只写名字", async () => {
    const { shown } = await pickAuthor(scene(), undefined);
    expect(shown).toEqual([
      { label: "Me", description: "t <t@example.com>" },
      { label: "Ann", description: "2 commits" },
      { label: "t <t@example.com>", description: "1 commit" },
    ]);
  });

  it("选中的交回名字、邮箱与是不是 Me；取消是 null", async () => {
    const repo = scene();
    expect((await pickAuthor(repo, 0)).picked).toEqual({
      name: "t",
      email: "t@example.com",
      me: true,
    });
    expect((await pickAuthor(repo, 1)).picked).toEqual({ name: "Ann", email: "", me: false });
    expect((await pickAuthor(repo, undefined)).picked).toBeNull();
  });
});

describe("handlers.pickPath", () => {
  afterAll(cleanupTempRepos);

  it("目录与文件带各自的图标；选中的交回路径，取消是 null", async () => {
    const path = makeTempRepo("pick-path");
    mkdirSync(join(path, "src"));
    writeFileSync(join(path, "src/a.ts"), "a");
    git(path, ["add", "-A"]);
    git(path, ["commit", "-q", "-m", "a"]);
    const run = async (answer: number | undefined) => {
      const repository = new Repository(plainLocation(path), cli);
      let shown: readonly PickItem[] = [];
      try {
        const picked = await createHandlers(repository, {
          ...NO_UI,
          pick: async (_title, items) => {
            shown = items;
            return answer;
          },
        }).pickPath({ repo: path });
        return { shown, picked };
      } finally {
        repository.dispose();
      }
    };
    const { shown, picked } = await run(1);
    expect(shown).toEqual([
      { label: "$(file) f1" },
      { label: "$(folder) src" },
      { label: "$(file) src/a.ts" },
    ]);
    expect(picked).toBe("src");
    expect((await run(undefined)).picked).toBeNull();
  });
});

describe("handlers.copyText", () => {
  afterAll(cleanupTempRepos);

  it("原样交给剪贴板", async () => {
    const path = makeTempRepo("copy");
    const repository = new Repository(plainLocation(path), cli);
    const copied: string[] = [];
    try {
      await createHandlers(repository, {
        ...NO_UI,
        copyText: async (text) => {
          copied.push(text);
        },
      }).copyText({ text: "a\nb" });
    } finally {
      repository.dispose();
    }
    expect(copied).toEqual(["a\nb"]);
  });
});

describe("handlers.openMergeEditor", () => {
  afterAll(cleanupTempRepos);
  const open = async (path: string, file: string) => {
    const repository = new Repository(plainLocation(path), cli);
    const opened: MergeSides[] = [];
    try {
      await createHandlers(repository, {
        ...NO_UI,
        openMergeEditor: async (_root, sides) => {
          opened.push(sides);
        },
      }).openMergeEditor({ repo: path, path: file });
      return opened;
    } finally {
      repository.dispose();
    }
  };

  it("三栏取暂存区，结果写回工作区的文件", async () => {
    const repo = stashConflict("merge-editor");
    expect(await open(repo, "both.txt")).toEqual([
      {
        base: { kind: DiffSideKind.Stage, stage: IndexStage.Base, path: "both.txt" },
        current: { kind: DiffSideKind.Stage, stage: IndexStage.Ours, path: "both.txt" },
        incoming: { kind: DiffSideKind.Stage, stage: IndexStage.Theirs, path: "both.txt" },
        output: "both.txt",
        currentTitle: "Current (main)",
        incomingTitle: "Incoming (Stashed Changes)",
      },
    ]);
  });

  it("两边都新增的没有基准：基准给空", async () => {
    const [sides] = await open(stashConflict("merge-editor-added"), "added.txt");
    expect(sides?.base).toEqual({ kind: DiffSideKind.Missing, path: "added.txt" });
  });

  it("没有冲突的文件：说明原因，不打开", async () => {
    await expect(open(stashConflict("merge-editor-clean"), "clean.txt")).rejects.toThrow(
      "clean.txt has no conflict.",
    );
  });
});

describe("解决冲突：markResolved / removeConflictFile / resolveDeletion / deleteUntracked", () => {
  afterAll(cleanupTempRepos);
  /** 跑一次，确认框回答 `sure`、选择框回答 `pick`；返回问了什么。 */
  const act = async (
    path: string,
    run: (h: ReturnType<typeof createHandlers>) => Promise<unknown>,
    answers: { sure?: boolean; pick?: number } = {},
  ) => {
    const repository = new Repository(plainLocation(path), cli);
    const asked: string[] = [];
    try {
      await run(
        createHandlers(repository, {
          ...NO_UI,
          confirm: async (message) => {
            asked.push(message);
            return answers.sure ?? false;
          },
          choose: async (message, actions) => {
            asked.push(`${message} [${actions.join(" / ")}]`);
            return answers.pick;
          },
        }),
      );
      return asked;
    } finally {
      repository.dispose();
    }
  };
  const status = (repo: string, file: string) =>
    git(repo, ["status", "--porcelain", "--", file]).trimEnd();

  it("还有冲突标记：先问，取消就不标记", async () => {
    const repo = stashConflict("resolve-markers");
    const asked = await act(repo, (h) => h.markResolved({ repo, path: "both.txt" }));
    expect(asked).toEqual(["both.txt still contains conflict markers. Mark as resolved anyway?"]);
    expect(status(repo, "both.txt")).toBe("UU both.txt");
  });

  it("没有冲突标记了：直接标记，移出冲突", async () => {
    const repo = stashConflict("resolve-clean");
    writeFileSync(join(repo, "both.txt"), "merged\n");
    expect(await act(repo, (h) => h.markResolved({ repo, path: "both.txt" }))).toEqual([]);
    expect(status(repo, "both.txt")).toBe("M  both.txt");
  });

  it("双击一边删了的：选 Keep 留下工作区那份，选 Delete File 删掉", async () => {
    const kept = stashConflict("resolve-keep");
    const asked = await act(kept, (h) => h.resolveDeletion({ repo: kept, path: "gone.txt" }), {
      pick: 0,
    });
    expect(asked).toEqual([
      "gone.txt was changed on our side and deleted on theirs. [Keep / Delete File]",
    ]);
    expect(status(kept, "gone.txt")).toBe("");
    const removed = stashConflict("resolve-delete");
    await act(removed, (h) => h.resolveDeletion({ repo: removed, path: "gone.txt" }), { pick: 1 });
    expect(status(removed, "gone.txt")).toBe("D  gone.txt");
  });

  it("右键 Delete File：删掉并移出冲突", async () => {
    const repo = stashConflict("resolve-remove");
    await act(repo, (h) => h.removeConflictFile({ repo, path: "gone.txt" }));
    expect(status(repo, "gone.txt")).toBe("D  gone.txt");
  });

  it("未跟踪文件 Add to Git：放进暂存区，不确认，磁盘上的内容还在", async () => {
    const repo = makeTempRepo("add-untracked");
    writeFileSync(join(repo, "junk.txt"), "x\n");
    expect(await act(repo, (h) => h.addUntracked({ repo, path: "junk.txt" }))).toEqual([]);
    expect(status(repo, "junk.txt")).toBe("A  junk.txt");
    expect(readFileSync(join(repo, "junk.txt"), "utf8")).toBe("x\n");
  });

  it("删未跟踪文件：确认后从磁盘删掉，取消就留着", async () => {
    const repo = makeTempRepo("delete-untracked");
    writeFileSync(join(repo, "junk.txt"), "x");
    await act(repo, (h) => h.deleteUntracked({ repo, path: "junk.txt" }));
    expect(status(repo, "junk.txt")).toBe("?? junk.txt");
    const asked = await act(repo, (h) => h.deleteUntracked({ repo, path: "junk.txt" }), {
      sure: true,
    });
    expect(asked).toEqual(["Delete junk.txt? This cannot be undone."]);
    expect(status(repo, "junk.txt")).toBe("");
  });
});

describe("停在半路：继续与放弃", () => {
  afterAll(cleanupTempRepos);

  /** 停在 merge 冲突：main 与 feature 改了同一个文件。 */
  const conflictedMerge = (name: string): string => {
    const repo = makeTempRepo(name);
    writeFileSync(join(repo, "f.txt"), "base\n");
    git(repo, ["add", "f.txt"]);
    git(repo, ["commit", "-qm", "base"]);
    git(repo, ["switch", "-q", "-c", "feature"]);
    writeFileSync(join(repo, "f.txt"), "feature\n");
    git(repo, ["commit", "-qam", "feature side"]);
    git(repo, ["switch", "-q", "main"]);
    writeFileSync(join(repo, "f.txt"), "main\n");
    git(repo, ["commit", "-qam", "main side"]);
    // 冲突是这个场景的前提；合上了就测不到继续和放弃。
    expect(() => git(repo, ["merge", "feature"])).toThrow();
    return repo;
  };

  const act = async (
    repo: string,
    run: (h: ReturnType<typeof createHandlers>) => Promise<unknown>,
    sure = true,
  ) => {
    const repository = new Repository(plainLocation(repo), cli);
    const asked: string[] = [];
    const said: string[] = [];
    const ui: HandlerUi = {
      ...NO_UI,
      confirm: async (message) => {
        asked.push(message);
        return sure;
      },
      withProgress: async (title, task, done) => {
        said.push(title);
        const value = await task();
        said.push(done(value));
        return value;
      },
    };
    try {
      await run(createHandlers(repository, ui));
      return { asked, said };
    } finally {
      repository.dispose();
    }
  };

  it("读到正在合并的分支和说明", async () => {
    const repo = conflictedMerge("op-read");
    const repository = new Repository(plainLocation(repo), cli);
    try {
      const operation = await createHandlers(repository, NO_UI).getOperation({ repo });
      expect(operation?.kind).toBe(OperationKind.Merge);
      expect(operation?.subject).toBe("feature");
      expect(operation?.message).toContain("Merge branch 'feature'");
    } finally {
      repository.dispose();
    }
  });

  it("放弃先确认：取消就留着，确认才中止", async () => {
    const kept = conflictedMerge("op-abort-cancel");
    const cancelled = await act(kept, (h) => h.abortOperation({ repo: kept }), false);
    expect(cancelled.asked).toEqual(["Abort the merge?"]);
    expect(cancelled.said).toEqual([]);
    expect(existsSync(join(kept, ".git", "MERGE_HEAD"))).toBe(true);

    const dropped = conflictedMerge("op-abort");
    const confirmed = await act(dropped, (h) => h.abortOperation({ repo: dropped }));
    expect(confirmed.asked).toEqual(["Abort the merge?"]);
    expect(confirmed.said).toEqual(["Aborting…", "Aborted"]);
    expect(existsSync(join(dropped, ".git", "MERGE_HEAD"))).toBe(false);
  });

  it("冲突解决后继续：用说明框里的那句提交，不带走别的改动", async () => {
    const repo = conflictedMerge("op-continue");
    writeFileSync(join(repo, "f.txt"), "resolved\n");
    git(repo, ["add", "f.txt"]);
    // 继续不能 git add 其它文件：这个已跟踪的改动该留在工作区。
    writeFileSync(join(repo, "f1"), "still dirty\n");
    const { said } = await act(repo, (h) => h.continueOperation({ repo, message: "edited merge" }));
    expect(said).toEqual(["Continuing…", "Merge completed"]);
    expect(git(repo, ["log", "-1", "--format=%s"]).trim()).toBe("edited merge");
    expect(git(repo, ["status", "--porcelain"]).trimEnd()).toBe(" M f1");
  });

  it("继续到下一条又冲突：不报错，停在新的那条", async () => {
    const repo = makeTempRepo("op-pick-next");
    writeFileSync(join(repo, "f.txt"), "base\n");
    writeFileSync(join(repo, "g.txt"), "g\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-qm", "base"]);
    git(repo, ["switch", "-q", "-c", "feature"]);
    writeFileSync(join(repo, "f.txt"), "one\n");
    git(repo, ["commit", "-qam", "one"]);
    writeFileSync(join(repo, "g.txt"), "two\n");
    git(repo, ["commit", "-qam", "two"]);
    git(repo, ["switch", "-q", "main"]);
    writeFileSync(join(repo, "f.txt"), "mainf\n");
    writeFileSync(join(repo, "g.txt"), "maing\n");
    git(repo, ["commit", "-qam", "mainboth"]);
    expect(() => git(repo, ["cherry-pick", "feature~1", "feature"])).toThrow();

    const repository = new Repository(plainLocation(repo), cli);
    try {
      const handlers = createHandlers(repository, {
        ...NO_UI,
        withProgress: (_title, task) => task(),
      });
      const first = await handlers.getOperation({ repo });
      expect(first?.kind).toBe(OperationKind.CherryPick);
      writeFileSync(join(repo, "f.txt"), "resolved\n");
      git(repo, ["add", "f.txt"]);
      const { said } = await act(repo, (h) =>
        h.continueOperation({ repo, message: "edited pick" }),
      );
      expect(said).toEqual(["Continuing…", "Stopped for conflicts"]);
      const second = await handlers.getOperation({ repo });
      expect(second?.kind).toBe(OperationKind.CherryPick);
      expect(second?.id).not.toBe(first?.id);
      expect(git(repo, ["log", "-1", "--format=%s"]).trim()).toBe("edited pick");
    } finally {
      repository.dispose();
    }
  });

  it("没有进行中的操作：直接说明，不跑 git", async () => {
    const repo = makeTempRepo("op-none");
    await expect(act(repo, (h) => h.continueOperation({ repo, message: "x" }))).rejects.toThrow(
      "No operation in progress.",
    );
    await expect(act(repo, (h) => h.abortOperation({ repo }))).rejects.toThrow(
      "No operation in progress.",
    );
  });
});

describe("分支右键：合并与变基", () => {
  afterAll(cleanupTempRepos);

  const run = async (
    repo: string,
    call: (handlers: ReturnType<typeof createHandlers>) => Promise<unknown>,
  ) => {
    const repository = new Repository(plainLocation(repo), cli);
    const said: string[] = [];
    const ui: HandlerUi = {
      ...NO_UI,
      withProgress: async (title, task, done) => {
        said.push(title);
        const value = await task();
        said.push(done(value));
        return value;
      },
    };
    try {
      await call(createHandlers(repository, ui));
      return said;
    } finally {
      repository.dispose();
    }
  };

  /** feature 比 main 多一次提交，main 没有自己的新提交。 */
  const ahead = (name: string): string => {
    const repo = makeTempRepo(name);
    git(repo, ["switch", "-q", "-c", "feature"]);
    writeFileSync(join(repo, "extra.txt"), "extra\n");
    git(repo, ["add", "extra.txt"]);
    git(repo, ["commit", "-qm", "feature"]);
    git(repo, ["switch", "-q", "main"]);
    return repo;
  };

  /** main 与 feature 都改了 f1。 */
  const bothTouched = (name: string): string => {
    const repo = makeTempRepo(name);
    git(repo, ["switch", "-q", "-c", "feature"]);
    writeFileSync(join(repo, "f1"), "feature\n");
    git(repo, ["commit", "-qam", "feature"]);
    git(repo, ["switch", "-q", "main"]);
    writeFileSync(join(repo, "f1"), "main\n");
    git(repo, ["commit", "-qam", "main"]);
    return repo;
  };

  it("快进，工作区里不相关的改动留着", async () => {
    const repo = ahead("merge-ff");
    writeFileSync(join(repo, "f1"), "dirty\n");
    const said = await run(repo, (h) =>
      h.merge({ repo, start: "refs/heads/feature", startName: "feature" }),
    );
    expect(said).toEqual(["Merging feature…", "Fast-forwarded to feature"]);
    expect(git(repo, ["rev-parse", "main"])).toBe(git(repo, ["rev-parse", "feature"]));
    expect(git(repo, ["status", "--porcelain"]).trimEnd()).toBe(" M f1");
  });

  it("已经包含：说一声，不再合一次", async () => {
    const repo = ahead("merge-uptodate");
    await run(repo, (h) => h.merge({ repo, start: "refs/heads/feature", startName: "feature" }));
    const said = await run(repo, (h) =>
      h.merge({ repo, start: "refs/heads/feature", startName: "feature" }),
    );
    expect(said).toEqual(["Merging feature…", "Already up to date"]);
  });

  it("分叉且文件不撞：合成一个合并提交", async () => {
    const repo = makeTempRepo("merge-join");
    git(repo, ["switch", "-q", "-c", "feature"]);
    writeFileSync(join(repo, "extra.txt"), "extra\n");
    git(repo, ["add", "extra.txt"]);
    git(repo, ["commit", "-qm", "feature"]);
    git(repo, ["switch", "-q", "main"]);
    writeFileSync(join(repo, "f1"), "main\n");
    git(repo, ["commit", "-qam", "main side"]);
    const said = await run(repo, (h) =>
      h.merge({ repo, start: "refs/heads/feature", startName: "feature" }),
    );
    expect(said).toEqual(["Merging feature…", "Merged feature"]);
    expect(git(repo, ["log", "-1", "--format=%s"]).trim()).toBe("Merge branch 'feature'");
  });

  it("合出冲突：停住，不弹确认", async () => {
    const repo = bothTouched("merge-stop");
    const said = await run(repo, (h) =>
      h.merge({ repo, start: "refs/heads/feature", startName: "feature" }),
    );
    expect(said).toEqual(["Merging feature…", "Stopped for conflicts"]);
    expect(existsSync(join(repo, ".git", "MERGE_HEAD"))).toBe(true);
    expect(readFileSync(join(repo, ".git", "MERGE_MSG"), "utf8")).toContain(
      "Merge branch 'feature'",
    );
  });

  it("工作区改动会被盖掉：git 拒绝，合并没有开始", async () => {
    const repo = bothTouched("merge-refuse");
    git(repo, ["reset", "-q", "--hard", "HEAD~1"]);
    writeFileSync(join(repo, "f1"), "dirty\n");
    await expect(
      run(repo, (h) => h.merge({ repo, start: "refs/heads/feature", startName: "feature" })),
    ).rejects.toThrow(/would be overwritten/);
    expect(existsSync(join(repo, ".git", "MERGE_HEAD"))).toBe(false);
  });

  it("变基到远程分支记录，已跟踪的改动取回", async () => {
    const repo = ahead("rebase-keep");
    git(repo, ["update-ref", "refs/remotes/origin/feature", "refs/heads/feature"]);
    writeFileSync(join(repo, "f1"), "dirty\n");
    const said = await run(repo, (h) =>
      h.rebase({ repo, start: "refs/remotes/origin/feature", startName: "origin/feature" }),
    );
    expect(said).toEqual(["Rebasing onto origin/feature…", "Rebased onto origin/feature"]);
    expect(git(repo, ["rev-parse", "main"])).toBe(git(repo, ["rev-parse", "feature"]));
    expect(git(repo, ["status", "--porcelain"]).trimEnd()).toBe(" M f1");
  });

  it("已经在目标上：说一声", async () => {
    const repo = ahead("rebase-uptodate");
    await run(repo, (h) => h.rebase({ repo, start: "refs/heads/feature", startName: "feature" }));
    const said = await run(repo, (h) =>
      h.rebase({ repo, start: "refs/heads/feature", startName: "feature" }),
    );
    expect(said).toEqual(["Rebasing onto feature…", "Already up to date"]);
  });

  it("变基冲突：停住", async () => {
    const repo = bothTouched("rebase-stop");
    const said = await run(repo, (h) =>
      h.rebase({ repo, start: "refs/heads/feature", startName: "feature" }),
    );
    expect(said).toEqual(["Rebasing onto feature…", "Stopped for conflicts"]);
    expect(existsSync(join(repo, ".git", "rebase-merge"))).toBe(true);
  });

  it("取回暂存的改动冲突：变基已经结束，工作区留下冲突", async () => {
    const repo = makeTempRepo("rebase-stash");
    git(repo, ["switch", "-q", "-c", "feature"]);
    writeFileSync(join(repo, "f1"), "feature\n");
    git(repo, ["commit", "-qam", "feature"]);
    git(repo, ["switch", "-q", "main"]);
    writeFileSync(join(repo, "f1"), "dirty\n");
    const said = await run(repo, (h) =>
      h.rebase({ repo, start: "refs/heads/feature", startName: "feature" }),
    );
    expect(said).toEqual([
      "Rebasing onto feature…",
      "Rebased onto feature. Applying the stashed changes has conflicts.",
    ]);
    expect(existsSync(join(repo, ".git", "rebase-merge"))).toBe(false);
    expect(existsSync(join(repo, ".git", "MERGE_HEAD"))).toBe(false);
    expect(git(repo, ["status", "--porcelain"]).trimEnd()).toBe("UU f1");
    expect(git(repo, ["rev-parse", "main"])).toBe(git(repo, ["rev-parse", "feature"]));
  });
});

describe("提交右键：cherry-pick、revert、变基到这条", () => {
  afterAll(cleanupTempRepos);

  const run = async (
    repo: string,
    call: (handlers: ReturnType<typeof createHandlers>) => Promise<unknown>,
  ) => {
    const repository = new Repository(plainLocation(repo), cli);
    const said: string[] = [];
    const ui: HandlerUi = {
      ...NO_UI,
      withProgress: async (title, task, done) => {
        said.push(title);
        const value = await task();
        said.push(done(value));
        return value;
      },
    };
    try {
      await call(createHandlers(repository, ui));
      return said;
    } finally {
      repository.dispose();
    }
  };

  const head = (repo: string): string => git(repo, ["rev-parse", "HEAD"]).trim();
  const short = (hash: string): string => hash.slice(0, 7);

  it("摘一条不相关的提交，工作区里不相关的改动留着", async () => {
    const repo = makeTempRepo("pick-ok");
    git(repo, ["switch", "-q", "-c", "feature"]);
    writeFileSync(join(repo, "extra.txt"), "extra\n");
    git(repo, ["add", "extra.txt"]);
    git(repo, ["commit", "-qm", "feature"]);
    const hash = head(repo);
    git(repo, ["switch", "-q", "main"]);
    writeFileSync(join(repo, "f1"), "dirty\n");
    const said = await run(repo, (h) => h.cherryPick({ repo, hash }));
    expect(said).toEqual([`Cherry-picking ${short(hash)}…`, `Cherry-picked ${short(hash)}`]);
    expect(git(repo, ["log", "-1", "--format=%s"]).trim()).toBe("feature");
    expect(git(repo, ["status", "--porcelain"]).trimEnd()).toBe(" M f1");
  });

  it("摘出冲突：停住，不弹确认", async () => {
    const repo = makeTempRepo("pick-stop");
    git(repo, ["switch", "-q", "-c", "feature"]);
    writeFileSync(join(repo, "f1"), "feature\n");
    git(repo, ["commit", "-qam", "feature"]);
    const hash = head(repo);
    git(repo, ["switch", "-q", "main"]);
    writeFileSync(join(repo, "f1"), "main\n");
    git(repo, ["commit", "-qam", "main"]);
    const said = await run(repo, (h) => h.cherryPick({ repo, hash }));
    expect(said).toEqual([`Cherry-picking ${short(hash)}…`, "Stopped for conflicts"]);
    expect(existsSync(join(repo, ".git", "CHERRY_PICK_HEAD"))).toBe(true);
  });

  it("工作区改动会被盖掉：git 拒绝，cherry-pick 没有开始", async () => {
    const repo = makeTempRepo("pick-refuse");
    git(repo, ["switch", "-q", "-c", "feature"]);
    writeFileSync(join(repo, "f1"), "feature\n");
    git(repo, ["commit", "-qam", "feature"]);
    const hash = head(repo);
    git(repo, ["switch", "-q", "main"]);
    writeFileSync(join(repo, "f1"), "dirty\n");
    await expect(run(repo, (h) => h.cherryPick({ repo, hash }))).rejects.toThrow(
      /would be overwritten/,
    );
    expect(existsSync(join(repo, ".git", "CHERRY_PICK_HEAD"))).toBe(false);
  });

  it("改动已经在了：停住，但不是冲突", async () => {
    const repo = makeTempRepo("pick-empty");
    git(repo, ["switch", "-q", "-c", "feature"]);
    writeFileSync(join(repo, "extra.txt"), "extra\n");
    git(repo, ["add", "extra.txt"]);
    git(repo, ["commit", "-qm", "feature"]);
    const hash = head(repo);
    git(repo, ["switch", "-q", "main"]);
    await run(repo, (h) => h.cherryPick({ repo, hash }));
    const said = await run(repo, (h) => h.cherryPick({ repo, hash }));
    expect(said).toEqual([`Cherry-picking ${short(hash)}…`, "Cherry-pick is now empty"]);
    expect(existsSync(join(repo, ".git", "CHERRY_PICK_HEAD"))).toBe(true);
  });

  it("合并提交：git 拒绝，原文里说明要 -m", async () => {
    const repo = makeTempRepo("pick-merge");
    git(repo, ["switch", "-q", "-c", "side"]);
    writeFileSync(join(repo, "side.txt"), "side\n");
    git(repo, ["add", "side.txt"]);
    git(repo, ["commit", "-qm", "side"]);
    git(repo, ["switch", "-q", "main"]);
    writeFileSync(join(repo, "f1"), "main\n");
    git(repo, ["commit", "-qam", "main side"]);
    git(repo, ["merge", "-q", "--no-edit", "side"]);
    const hash = head(repo);
    git(repo, ["reset", "-q", "--hard", "HEAD~1"]);
    await expect(run(repo, (h) => h.cherryPick({ repo, hash }))).rejects.toThrow(/no -m option/);
    expect(existsSync(join(repo, ".git", "CHERRY_PICK_HEAD"))).toBe(false);
  });

  it("反向提交，工作区里不相关的改动留着", async () => {
    const repo = makeTempRepo("revert-ok");
    writeFileSync(join(repo, "f1"), "next\n");
    git(repo, ["commit", "-qam", "next"]);
    const hash = head(repo);
    writeFileSync(join(repo, "note.txt"), "base\n");
    git(repo, ["add", "note.txt"]);
    git(repo, ["commit", "-qm", "note"]);
    writeFileSync(join(repo, "note.txt"), "dirty\n");
    const said = await run(repo, (h) => h.revert({ repo, hash }));
    expect(said).toEqual([`Reverting ${short(hash)}…`, `Reverted ${short(hash)}`]);
    expect(git(repo, ["log", "-1", "--format=%s"]).trim()).toBe('Revert "next"');
    expect(git(repo, ["status", "--porcelain"]).trimEnd()).toBe(" M note.txt");
  });

  it("反向提交冲突：停住", async () => {
    const repo = makeTempRepo("revert-stop");
    writeFileSync(join(repo, "f1"), "second\n");
    git(repo, ["commit", "-qam", "second"]);
    const hash = head(repo);
    writeFileSync(join(repo, "f1"), "third\n");
    git(repo, ["commit", "-qam", "third"]);
    const said = await run(repo, (h) => h.revert({ repo, hash }));
    expect(said).toEqual([`Reverting ${short(hash)}…`, "Stopped for conflicts"]);
    expect(existsSync(join(repo, ".git", "REVERT_HEAD"))).toBe(true);
  });

  it("变基到一条提交，已跟踪的改动取回", async () => {
    const repo = makeTempRepo("rebase-hash");
    git(repo, ["switch", "-q", "-c", "feature"]);
    writeFileSync(join(repo, "extra.txt"), "extra\n");
    git(repo, ["add", "extra.txt"]);
    git(repo, ["commit", "-qm", "feature"]);
    const hash = head(repo);
    git(repo, ["switch", "-q", "main"]);
    writeFileSync(join(repo, "f1"), "dirty\n");
    const said = await run(repo, (h) => h.rebase({ repo, start: hash, startName: short(hash) }));
    expect(said).toEqual([`Rebasing onto ${short(hash)}…`, `Rebased onto ${short(hash)}`]);
    expect(head(repo)).toBe(hash);
    expect(git(repo, ["status", "--porcelain"]).trimEnd()).toBe(" M f1");
  });
});

describe("handlers.resetTo", () => {
  afterAll(cleanupTempRepos);
  const reset = async (path: string, hash: string, pick: number | undefined) => {
    const repository = new Repository(plainLocation(path), cli);
    const asked: { message: string; actions: readonly string[]; detail?: string | undefined }[] =
      [];
    try {
      await createHandlers(repository, {
        ...NO_UI,
        choose: async (message, actions, detail) => {
          asked.push({ message, actions, detail });
          return pick;
        },
      }).resetTo({ repo: path, hash });
      return asked;
    } finally {
      repository.dispose();
    }
  };
  const scene = () => {
    const repo = makeTempRepo("reset-handler");
    const first = git(repo, ["rev-parse", "HEAD"]).trim();
    git(repo, ["commit", "-q", "--allow-empty", "-m", "second\n\nbody"]);
    return { repo, first };
  };

  it("对话框：写明分支、短 hash 与说明首行，四个按钮从轻到重，每个附一句说明", async () => {
    const { repo, first } = scene();
    const [asked] = await reset(repo, first, undefined);
    expect(asked?.message).toBe(`Reset main to ${first.slice(0, 7)} "init"?`);
    expect(asked?.actions).toEqual(["Soft", "Mixed", "Keep", "Hard"]);
    expect(asked?.detail?.split("\n").map((line) => line.split(":")[0])).toEqual([
      "Soft",
      "Mixed",
      "Keep",
      "Hard",
    ]);
  });

  it("取消：什么都不动；选了就按那一种做", async () => {
    const { repo, first } = scene();
    const before = git(repo, ["rev-parse", "HEAD"]).trim();
    await reset(repo, first, undefined);
    expect(git(repo, ["rev-parse", "HEAD"]).trim()).toBe(before);
    await reset(repo, first, 3);
    expect(git(repo, ["rev-parse", "HEAD"]).trim()).toBe(first);
  });
});

describe("handlers.reword", () => {
  afterAll(cleanupTempRepos);
  const reword = async (path: string, hash: string, message: string) => {
    const repository = new Repository(plainLocation(path), cli);
    const said: string[] = [];
    const closed: DialogKind[] = [];
    try {
      await createHandlers(repository, {
        ...NO_UI,
        closeDialog: (dialog) => void closed.push(dialog),
        withProgress: async (title, task, done) => {
          said.push(title);
          const value = await task();
          said.push(done(value));
          return value;
        },
      }).reword({ repo: path, hash, message });
      return { said, closed };
    } finally {
      repository.dispose();
    }
  };

  it("关掉对话框，改写，状态栏说改了哪条", async () => {
    const repo = makeTempRepo("reword-handler");
    const hash = git(repo, ["rev-parse", "HEAD"]).trim();
    const { said, closed } = await reword(repo, hash, "renamed");
    expect(closed).toEqual([DialogKind.Reword]);
    expect(said).toEqual(["Rewording…", `Reworded ${hash.slice(0, 7)}`]);
    expect(git(repo, ["log", "-1", "--format=%s"]).trim()).toBe("renamed");
  });

  it("merge 停在半路：拒绝，对话框不关，什么都不动", async () => {
    const repo = makeTempRepo("reword-merging");
    git(repo, ["switch", "-qc", "side"]);
    writeFileSync(join(repo, "f1"), "side\n");
    git(repo, ["commit", "-qam", "side"]);
    git(repo, ["switch", "-q", "main"]);
    writeFileSync(join(repo, "f1"), "main\n");
    git(repo, ["commit", "-qam", "main"]);
    try {
      git(repo, ["merge", "-q", "side"]);
    } catch {
      // 冲突：merge 以非 0 退出，停在半路。
    }
    const head = git(repo, ["rev-parse", "HEAD"]).trim();
    const closed: DialogKind[] = [];
    const repository = new Repository(plainLocation(repo), cli);
    try {
      await expect(
        createHandlers(repository, {
          ...NO_UI,
          closeDialog: (dialog) => void closed.push(dialog),
        }).reword({ repo, hash: head, message: "x" }),
      ).rejects.toThrow("Cannot edit commit messages while a merge is in progress.");
    } finally {
      repository.dispose();
    }
    expect(closed).toEqual([]);
    expect(git(repo, ["rev-parse", "HEAD"]).trim()).toBe(head);
  });
});
