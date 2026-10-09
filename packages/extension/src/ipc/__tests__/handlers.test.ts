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
import { createHandlers, type HandlerUi, type PickItem } from "../handlers.js";
import { UserFacingError } from "../userFacingError.js";

/** 不涉及界面的测试用它：真调到就说明测错了东西。 */
const NO_UI: HandlerUi = {
  confirmRollback: () => Promise.reject(new Error("测试里不该弹确认")),
  withProgress: (_title, task) => task(),
  askBranchName: () => Promise.reject(new Error("测试里不该弹输入框")),
  confirm: () => Promise.reject(new Error("测试里不该弹确认")),
  notify: () => undefined,
  pick: () => Promise.reject(new Error("测试里不该弹选择框")),
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

describe("handlers.push", () => {
  afterAll(cleanupTempRepos);
  const pushBranch = async (path: string, branch: string) => {
    const repository = new Repository(plainLocation(path), cli);
    try {
      await createHandlers(repository, NO_UI).push({ repo: path, branch });
    } finally {
      repository.dispose();
    }
  };
  const repos = () => {
    const { remote, repo } = makeTrackingRepos();
    git(remote, ["config", "receive.denyCurrentBranch", "ignore"]);
    return { remote, repo };
  };

  it("没有上游的新分支：推到唯一远程的同名分支，并设为上游", async () => {
    const { remote, repo } = repos();
    git(repo, ["branch", "-q", "feat"]);
    await pushBranch(repo, "feat");
    expect(git(remote, ["rev-parse", "feat"])).toBe(git(repo, ["rev-parse", "feat"]));
    expect(git(repo, ["rev-parse", "--abbrev-ref", "feat@{upstream}"]).trim()).toBe("origin/feat");
  });

  it("没有上游、多个远程且没有 origin：给一句说明，不推", async () => {
    const { repo } = repos();
    git(repo, ["remote", "rename", "origin", "a"]);
    git(repo, ["remote", "add", "b", "https://example.invalid/b.git"]);
    git(repo, ["branch", "-q", "feat"]);
    await expect(pushBranch(repo, "feat")).rejects.toThrow(
      "Cannot choose a remote for feat: the repository has several remotes and none is named origin.",
    );
  });

  it("被拒绝：给一句说明，git 原文留在 detail", async () => {
    const { remote, repo } = repos();
    git(remote, ["commit", "-q", "--allow-empty", "-m", "remote"]);
    git(repo, ["commit", "-q", "--allow-empty", "-m", "local"]);
    const error = await pushBranch(repo, "main").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UserFacingError);
    expect(error instanceof UserFacingError && error.message).toBe(
      "Push rejected: origin/main has commits that main doesn't have. Pull first.",
    );
    expect(error instanceof UserFacingError && error.detail).toContain("[rejected]");
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
