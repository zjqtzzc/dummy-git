import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  DialogKind,
  DiffSideKind,
  GitDomain,
  IndexStage,
  MessageKind,
  OperationKind,
  PushTagMode,
  RefKind,
} from "@dummy-git/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
  logWebviewError: () => undefined,
  openFile: () => Promise.reject(new Error("测试里不该打开文件")),
  openMergeEditor: () => Promise.reject(new Error("测试里不该打开合并编辑器")),
  openDiff: () => Promise.reject(new Error("测试里不该打开 diff")),
};

import { Router } from "../router.js";

describe("handlers.getRefs", () => {
  let repository: Repository;
  beforeAll(async () => {
    repository = new Repository(await getRepositoryLocation.execute(cli, fixtures.base), cli);
  });
  afterAll(() => repository.dispose());

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
        // HEAD 变了给**两个**域，不只是 Refs：切分支同时改 ref 与工作区文件（`core/classify.ts`）。
        payload: { repo: repository.location.root, domains: [GitDomain.Refs, GitDomain.Worktree] },
      },
    ]);
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

  it("改名后又删掉新路径：界面只给旧路径，暂存区里的新路径也一起提交，不剩下一个 AD", async () => {
    const path = makeTempRepo("commit-rename-deleted");
    git(path, ["mv", "f1", "renamed"]);
    rmSync(join(path, "renamed"));
    const repository = new Repository(plainLocation(path), cli);
    await createHandlers(repository, NO_UI).commit({
      repo: path,
      message: "delete",
      paths: ["f1"],
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

  it("改名后又删掉新路径：界面只给旧路径，暂存区里的新路径也一起撤掉", async () => {
    const path = makeTempRepo("rollback-rename-deleted");
    git(path, ["mv", "f1", "renamed"]);
    rmSync(join(path, "renamed"));
    const repository = new Repository(plainLocation(path), cli);
    await createHandlers(repository, { ...NO_UI, confirmRollback: async () => true }).rollback({
      repo: path,
      paths: ["f1"],
    });
    repository.dispose();
    expect(git(path, ["status", "--porcelain"]).trim()).toBe("");
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
      await createHandlers(repository, NO_UI).update({ repo: path, branches: [branch] });
    } finally {
      repository.dispose();
    }
  };

  /** 分叉后选一个按钮。`undefined` 是关掉通知。返回问了几次。 */
  const updateDiverged = async (path: string, branch: string, choice: number | undefined) => {
    const repository = new Repository(plainLocation(path), cli);
    let asked = 0;
    try {
      await createHandlers(repository, {
        ...NO_UI,
        notifyChoice: async () => {
          asked++;
          return choice;
        },
      }).update({ repo: path, branches: [branch] });
      return asked;
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
    await expect(update(repo, "lonely")).rejects.toThrow(UserFacingError);
  });

  it("关掉通知：本地分支不动，远程记录已经是新的", async () => {
    const { remote, repo } = makeTrackingRepos();
    diverge(remote, repo, "main");
    const local = git(repo, ["rev-parse", "main"]);
    expect(await updateDiverged(repo, "main", undefined)).toBe(1);
    expect(git(repo, ["rev-parse", "main"])).toBe(local);
    expect(git(repo, ["rev-parse", "origin/main"])).toBe(git(remote, ["rev-parse", "main"]));
  });

  it("选 Rebase：当前分支接到远程之上，未提交的改动还在", async () => {
    const { remote, repo } = makeTrackingRepos();
    diverge(remote, repo, "main");
    writeFileSync(join(repo, "f1"), "dirty\n");
    await updateDiverged(repo, "main", 0);
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
    await updateDiverged(repo, "main", 1);
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
    await updateDiverged(repo, "main", 1);
    expect(existsSync(join(repo, ".git", "MERGE_HEAD"))).toBe(true);
  });

  /** 分叉通知开着时用户切到了 other，再选按钮。 */
  const switchAwayThenChoose = async (repo: string, choice: number): Promise<void> => {
    const repository = new Repository(plainLocation(repo), cli);
    try {
      await createHandlers(repository, {
        ...NO_UI,
        notifyChoice: async () => {
          git(repo, ["switch", "-q", "other"]);
          return choice;
        },
      }).update({ repo, branches: ["main"] });
    } finally {
      repository.dispose();
    }
  };

  it("通知开着时切走了再选 Rebase：变基的仍是点的那条，切过去的那条不动", async () => {
    const { remote, repo } = makeTrackingRepos();
    diverge(remote, repo, "main");
    const other = git(repo, ["rev-parse", "other"]);
    await switchAwayThenChoose(repo, 0);
    expect(git(repo, ["rev-parse", "other"])).toBe(other);
    expect(git(repo, ["log", "-1", "--format=%s", "main"]).trim()).toBe("local");
    git(repo, ["merge-base", "--is-ancestor", "origin/main", "main"]);
  });

  it("通知开着时切走了再选 Merge：先切回点的那条再合并，切过去的那条不动", async () => {
    const { remote, repo } = makeTrackingRepos();
    diverge(remote, repo, "main");
    const other = git(repo, ["rev-parse", "other"]);
    await switchAwayThenChoose(repo, 1);
    expect(git(repo, ["rev-parse", "other"])).toBe(other);
    expect(git(repo, ["branch", "--show-current"]).trim()).toBe("main");
    expect(git(repo, ["log", "-1", "--format=%s"]).trim()).toBe(
      "Merge remote-tracking branch 'origin/main'",
    );
  });

  it("非当前分支选 Rebase：先切到那条，原来的当前分支不动", async () => {
    const { remote, repo } = makeTrackingRepos();
    diverge(remote, repo, "other");
    const main = git(repo, ["rev-parse", "main"]);
    await updateDiverged(repo, "other", 0);
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
    await updateDiverged(repo, "other", 1);
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
    expect(await updateDiverged(repo, "other", undefined)).toBe(1);
    expect(git(repo, ["branch", "--show-current"]).trim()).toBe("main");
    expect(git(repo, ["rev-parse", "other"])).toBe(other);
    expect(git(repo, ["rev-parse", "origin/main"])).toBe(git(remote, ["rev-parse", "main"]));
  });

  /** 一次更新好几个：返回状态栏说过的话、最后的完成消息，以及问没问过变基还是合并。 */
  const updateMany = async (path: string, branches: readonly string[]) => {
    const repository = new Repository(plainLocation(path), cli);
    const said: string[] = [];
    let asked = false;
    try {
      const done = await createHandlers(repository, {
        ...NO_UI,
        notify: (message) => {
          said.push(message);
        },
        notifyChoice: async () => {
          asked = true;
          return undefined;
        },
        withProgress: async (_title, task, finish) => {
          const value = await task();
          said.push(finish(value));
          return value;
        },
      })
        .update({ repo: path, branches })
        .then(
          () => undefined,
          (error: unknown) => error,
        );
      return { said, asked, error: done };
    } finally {
      repository.dispose();
    }
  };

  it("好几个：逐个快进，每个各说一句，最后汇总", async () => {
    const { remote, repo } = makeTrackingRepos();
    git(remote, ["commit", "-q", "--allow-empty", "-m", "remote"]);
    git(repo, ["fetch", "-q", "origin"]);
    git(repo, ["branch", "-q", "--track", "latest", "origin/main"]);
    const { said, error } = await updateMany(repo, ["main", "other", "latest"]);
    expect(error).toBeUndefined();
    expect(said).toEqual([
      "Updated main from origin/main",
      "Updated other from origin/main",
      "latest is up to date",
      "Updated 2 branches, 1 already up to date",
    ]);
    const tip = git(remote, ["rev-parse", "main"]);
    expect(git(repo, ["rev-parse", "main"])).toBe(tip);
    expect(git(repo, ["rev-parse", "other"])).toBe(tip);
  });

  it("好几个里有分叉的：不问，跳过它接着做别的，最后报错列出来", async () => {
    const { remote, repo } = makeTrackingRepos();
    diverge(remote, repo, "other");
    const other = git(repo, ["rev-parse", "other"]);
    const { said, asked, error } = await updateMany(repo, ["other", "main"]);
    expect(asked).toBe(false);
    expect(said).toEqual(["Updated main from origin/main", "Updated 1 branch, 1 diverged"]);
    expect(error).toBeInstanceOf(UserFacingError);
    expect(String(error)).toContain("other has diverged from its upstream and was not updated");
    expect(git(repo, ["rev-parse", "other"])).toBe(other);
    expect(git(repo, ["rev-parse", "main"])).toBe(git(remote, ["rev-parse", "main"]));
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

  /** `feat` 跟踪 `origin/old`，远程删掉 `old` 后 fetch --prune：上游成了 gone。 */
  const goneUpstream = (repo: string, remote: string) => {
    git(repo, ["push", "-q", "origin", "main:old"]);
    git(repo, ["branch", "-q", "--track", "feat", "origin/old"]);
    git(remote, ["branch", "-q", "-D", "old"]);
    git(repo, ["fetch", "-q", "--prune"]);
  };

  it("上游已 gone：当作没有上游，默认推到同名分支，并改设为上游", async () => {
    const { remote, repo } = repos();
    goneUpstream(repo, remote);
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

  it("上游已 gone、远程已有同名分支：推过去照样设为上游", async () => {
    const { remote, repo } = repos();
    goneUpstream(repo, remote);
    git(repo, ["push", "-q", "origin", "main:feat"]);
    await withHandlers(repo, (handlers) =>
      handlers.push({ repo, branch: "feat", remote: "origin", remoteBranch: "feat", force: false }),
    );
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

  it("被拒绝：报给用户，远程不动", async () => {
    const { remote, repo } = repos();
    git(remote, ["commit", "-q", "--allow-empty", "-m", "remote"]);
    git(repo, ["commit", "-q", "--allow-empty", "-m", "local"]);
    const before = git(remote, ["rev-parse", "main"]);
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
    expect(git(remote, ["rev-parse", "main"])).toBe(before);
  });

  it("带 tag 推送、远程已有同名 tag：分支推上去了，报错说清分支的结果和被拒的 tag", async () => {
    const { remote, repo } = repos();
    git(remote, ["tag", "v1"]);
    git(repo, ["commit", "-q", "--allow-empty", "-m", "local"]);
    git(repo, ["tag", "v1"]);
    const error = await withHandlers(repo, (handlers) =>
      handlers.push({
        repo,
        branch: "main",
        remote: "origin",
        remoteBranch: "main",
        force: false,
        tags: PushTagMode.All,
      }),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UserFacingError);
    expect(error instanceof UserFacingError && error.message).toBe(
      "Pushed main → origin/main, but tags were rejected: v1 [rejected] (already exists)",
    );
    expect(git(remote, ["rev-parse", "main"])).toBe(git(repo, ["rev-parse", "main"]));
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

  /** 返回确认框弹了几次。 */
  const forcePush = async (path: string, sure: boolean) => {
    let asked = 0;
    const repository = new Repository(plainLocation(path), cli);
    const ui: HandlerUi = {
      ...NO_UI,
      confirm: async () => {
        asked++;
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
    expect(await forcePush(repo, true)).toBe(1);
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
  /** 检出 `origin/<branch>`。 */
  const checkoutRemote = async (path: string, branch: string): Promise<void> => {
    const repository = new Repository(plainLocation(path), cli);
    try {
      await createHandlers(repository, NO_UI).checkoutRemote({
        repo: path,
        remote: "origin",
        branch,
      });
    } finally {
      repository.dispose();
    }
  };
  const current = (repo: string) => git(repo, ["branch", "--show-current"]).trim();
  const tip = (repo: string, ref: string) => git(repo, ["rev-parse", ref]).trim();

  it("本地没有同名分支：建一个跟踪它的并切过去", async () => {
    const { remote, repo } = makeTrackingRepos();
    git(remote, ["branch", "-q", "feat"]);
    git(repo, ["fetch", "-q", "origin"]);
    await checkoutRemote(repo, "feat");
    expect(current(repo)).toBe("feat");
    expect(git(repo, ["rev-parse", "--abbrev-ref", "feat@{u}"]).trim()).toBe("origin/feat");
  });

  it("本地同名分支跟踪它且落后：切过去并快进", async () => {
    const { remote, repo } = makeTrackingRepos();
    git(remote, ["commit", "-q", "--allow-empty", "-m", "remote"]);
    git(repo, ["fetch", "-q", "origin"]);
    git(repo, ["switch", "-q", "other"]);
    await checkoutRemote(repo, "main");
    expect(current(repo)).toBe("main");
    expect(tip(repo, "main")).toBe(tip(remote, "main"));
  });

  it("本地同名分支跟踪它且领先：只切过去", async () => {
    const { repo } = makeTrackingRepos();
    git(repo, ["commit", "-q", "--allow-empty", "-m", "local"]);
    const before = tip(repo, "main");
    git(repo, ["switch", "-q", "other"]);
    await checkoutRemote(repo, "main");
    expect(current(repo)).toBe("main");
    expect(tip(repo, "main")).toBe(before);
  });

  it("本地同名分支跟踪它但已分叉：切过去、不动它", async () => {
    const { remote, repo } = makeTrackingRepos();
    git(remote, ["commit", "-q", "--allow-empty", "-m", "remote"]);
    git(repo, ["fetch", "-q", "origin"]);
    git(repo, ["commit", "-q", "--allow-empty", "-m", "local"]);
    const before = tip(repo, "main");
    git(repo, ["switch", "-q", "other"]);
    await checkoutRemote(repo, "main");
    expect(current(repo)).toBe("main");
    expect(tip(repo, "main")).toBe(before);
  });

  it("本地同名分支不跟踪它：不切，报给用户", async () => {
    const { remote, repo } = makeTrackingRepos();
    git(remote, ["branch", "-q", "feat"]);
    git(repo, ["fetch", "-q", "origin"]);
    git(repo, ["branch", "-q", "feat"]);
    await expect(checkoutRemote(repo, "feat")).rejects.toThrow(UserFacingError);
    expect(current(repo)).toBe("main");
  });
});

describe("handlers.newBranch", () => {
  afterAll(cleanupTempRepos);
  /**
   * 从 `start` 建分支，输入框回答 `answer`。输入框开着时把 `probes` 逐个喂给校验函数，
   * 返回每个探针有没有校验出问题。
   */
  const newBranch = async (
    path: string,
    start: string,
    startName: string,
    answer: string | undefined,
    probes: readonly string[] = [],
  ) => {
    const repository = new Repository(plainLocation(path), cli);
    const problems: boolean[] = [];
    const ui: HandlerUi = {
      ...NO_UI,
      askBranchName: async (_title, _value, validate) => {
        for (const probe of probes) problems.push((await validate(probe)) !== undefined);
        return answer;
      },
    };
    try {
      await createHandlers(repository, ui).newBranch({ repo: path, start, startName });
      return problems;
    } finally {
      repository.dispose();
    }
  };

  it("从远程分支建：切过去，不跟踪起点", async () => {
    const { remote, repo } = makeTrackingRepos();
    git(remote, ["commit", "-q", "--allow-empty", "-m", "remote"]);
    git(repo, ["fetch", "-q", "origin"]);
    await newBranch(repo, "refs/remotes/origin/main", "origin/main", "fix");
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
    const problems = await newBranch(repo, "refs/heads/main", "main", undefined, [
      "a b",
      "feat",
      "feat-2",
      "",
    ]);
    expect(problems).toEqual([true, true, false, false]);
  });
});

describe("handlers.renameBranch", () => {
  afterAll(cleanupTempRepos);
  /** 改 `branch` 的名字，输入框回答 `answer`；返回输入框收到的预填值与每个探针有没有校验出问题。 */
  const rename = async (
    path: string,
    branch: string,
    answer: string | undefined,
    probes: readonly string[] = [],
  ) => {
    const repository = new Repository(plainLocation(path), cli);
    let prefilled = "";
    const problems: boolean[] = [];
    const ui: HandlerUi = {
      ...NO_UI,
      askBranchName: async (_title, value, validate) => {
        prefilled = value;
        for (const probe of probes) problems.push((await validate(probe)) !== undefined);
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
    expect(problems).toEqual([false, true]);
  });
});

describe("handlers.deleteBranches", () => {
  afterAll(cleanupTempRepos);
  /** 跑一次删除，确认框都回答 `sure`；返回问过的话（带名单的写在后面）与状态栏说过的话。 */
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
      confirm: async (message, _action, names) => {
        asked.push(names === undefined ? message : `${message} [${names.join(", ")}]`);
        return sure;
      },
      notify: (message) => {
        said.push(message);
      },
    };
    try {
      await act(createHandlers(repository, ui));
      return { asked, said };
    } finally {
      repository.dispose();
    }
  };
  /** 分支名。`origin/HEAD`（新版 git 的 fetch 会自动建）只是指向默认分支的指针，不列。 */
  const branches = (repo: string, args: readonly string[] = []) =>
    git(repo, ["branch", ...args, "--format=%(if)%(symref)%(then)%(else)%(refname:short)%(end)"])
      .split("\n")
      .filter((line) => line !== "");
  /** 在 `name` 上做一条只有它有的提交，回到 main。 */
  const unmerged = (repo: string, name: string) => {
    git(repo, ["switch", "-q", "-c", name]);
    git(repo, ["commit", "-q", "--allow-empty", "-m", `only ${name}`]);
    git(repo, ["switch", "-q", "main"]);
  };

  it("一个已合并的：直接删，不问，状态栏是 git 那句", async () => {
    const repo = makeTempRepo("delete-merged");
    git(repo, ["branch", "-q", "feat"]);
    const { asked, said } = await run(
      repo,
      (h) => h.deleteBranches({ repo, local: ["feat"], remote: [] }),
      false,
    );
    expect(asked).toEqual([]);
    expect(said).toEqual([expect.stringMatching(/^Deleted branch feat \(was [0-9a-f]+\)\.$/)]);
    expect(branches(repo)).toEqual(["main"]);
  });

  it("一个没合并的：问一次，确认后强删；取消就留着", async () => {
    const repo = makeTempRepo("delete-unmerged");
    unmerged(repo, "feat");
    const cancelled = await run(
      repo,
      (h) => h.deleteBranches({ repo, local: ["feat"], remote: [] }),
      false,
    );
    expect(cancelled.asked).toEqual([
      "feat has commits that are not merged anywhere. Delete it anyway?",
    ]);
    expect(branches(repo)).toEqual(["feat", "main"]);
    await run(repo, (h) => h.deleteBranches({ repo, local: ["feat"], remote: [] }), true);
    expect(branches(repo)).toEqual(["main"]);
  });

  it("一批本地：已合并的直接删，没合并的收在一起问一次，每个分支状态栏各一句，最后说删了几个", async () => {
    const repo = makeTempRepo("delete-batch");
    git(repo, ["branch", "-q", "done"]);
    unmerged(repo, "wip1");
    unmerged(repo, "wip2");
    const { asked, said } = await run(
      repo,
      (h) => h.deleteBranches({ repo, local: ["done", "wip1", "wip2"], remote: [] }),
      true,
    );
    expect(asked).toEqual([
      "2 branches have commits that are not merged anywhere. Delete them anyway? [wip1, wip2]",
    ]);
    expect(said.map((line) => line.replace(/\(was [0-9a-f]+\)/, "(was …)"))).toEqual([
      "Deleted branch done (was …).",
      "Deleted branch wip1 (was …).",
      "Deleted branch wip2 (was …).",
      "Deleted 3 branches",
    ]);
    expect(branches(repo)).toEqual(["main"]);
  });

  it("本地与远程混在一起：先删本地，远程问一次再删，本地同名分支不动", async () => {
    const { remote, repo } = makeTrackingRepos();
    git(remote, ["branch", "-q", "feat"]);
    git(remote, ["branch", "-q", "fix"]);
    git(repo, ["fetch", "-q", "origin"]);
    git(repo, ["branch", "-q", "feat"]);
    git(repo, ["branch", "-q", "done"]);
    const { asked } = await run(
      repo,
      (h) =>
        h.deleteBranches({
          repo,
          local: ["done"],
          remote: [
            { remote: "origin", branch: "feat" },
            { remote: "origin", branch: "fix" },
          ],
        }),
      true,
    );
    expect(asked).toEqual([
      "Delete 2 branches on remotes? This removes them for everyone using the remote. [origin/feat, origin/fix]",
    ]);
    expect(branches(remote)).toEqual(["main"]);
    expect(branches(repo, ["-r"])).toEqual(["origin/main"]);
    expect(branches(repo)).toContain("feat");
    expect(branches(repo)).not.toContain("done");
  });

  it("远程、取消：远程不动", async () => {
    const { remote, repo } = makeTrackingRepos();
    git(remote, ["branch", "-q", "feat"]);
    git(repo, ["fetch", "-q", "origin"]);
    await run(
      repo,
      (h) => h.deleteBranches({ repo, local: [], remote: [{ remote: "origin", branch: "feat" }] }),
      false,
    );
    expect(branches(remote)).toEqual(["feat", "main"]);
  });
});

describe("handlers.stash", () => {
  afterAll(cleanupTempRepos);
  const stash = async (path: string, paths: readonly string[]) => {
    const repository = new Repository(plainLocation(path), cli);
    try {
      await createHandlers(repository, NO_UI).stash({ repo: path, paths });
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
    await stash(repo, ["a2", "b", "u"]);
    expect(stashes(repo)).toHaveLength(1);
    expect(status(repo)).toEqual([" M keep"]);
    git(repo, ["stash", "apply", "-q"]);
    expect(status(repo).sort()).toEqual([" D a", " D b", " M keep", "?? u", "A  a2"].sort());
  });

  it("改名后又删掉新路径：界面只给旧路径，整个改名存走，只存一条", async () => {
    const repo = scene("stash-rename-deleted");
    rmSync(join(repo, "a2"));
    await stash(repo, ["a"]);
    expect(stashes(repo)).toHaveLength(1);
    expect(status(repo).sort()).toEqual(["D  b", " M keep", "?? u"].sort());
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
    try {
      await run(createHandlers(repository, { ...NO_UI, confirm: async () => sure }));
    } finally {
      repository.dispose();
    }
  };

  it("Apply：取回工作区，stash 保留", async () => {
    const { repo, older } = scene("stash-apply");
    await act(repo, (h) => h.applyStash({ repo, hash: older }));
    expect(git(repo, ["status", "--porcelain"]).trim()).toBe("M f1");
    expect(stashes(repo)).toHaveLength(2);
  });

  it("Pop 较早的那条：取回它、只删它", async () => {
    const { repo, newer, older } = scene("stash-pop");
    await act(repo, (h) => h.popStash({ repo, hash: older }));
    expect(git(repo, ["status", "--porcelain"]).trim()).toBe("M f1");
    expect(stashes(repo)).toEqual([newer]);
  });

  it("Delete 较早的那条：确认后只删它", async () => {
    const { repo, newer, older } = scene("stash-drop");
    await act(repo, (h) => h.dropStash({ repo, hash: older }));
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
    const ui: HandlerUi = { ...NO_UI, pick: async () => answer };
    try {
      const hashes = git(path, ["log", "--format=%H"]).trim().split("\n");
      return await createHandlers(repository, ui).pickAuthor({ repo: path, hashes });
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

  it("选中的交回名字、邮箱与是不是 Me；取消是 null", async () => {
    const repo = scene();
    expect(await pickAuthor(repo, 0)).toEqual({
      name: "t",
      email: "t@example.com",
      me: true,
    });
    expect(await pickAuthor(repo, 1)).toEqual({ name: "Ann", email: "", me: false });
    expect(await pickAuthor(repo, undefined)).toBeNull();
  });
});

describe("handlers.pickPath", () => {
  afterAll(cleanupTempRepos);

  it("选中的交回路径，取消是 null", async () => {
    const path = makeTempRepo("pick-path");
    mkdirSync(join(path, "src"));
    writeFileSync(join(path, "src/a.ts"), "a");
    git(path, ["add", "-A"]);
    git(path, ["commit", "-q", "-m", "a"]);
    const run = async (answer: number | undefined) => {
      const repository = new Repository(plainLocation(path), cli);
      try {
        return await createHandlers(repository, { ...NO_UI, pick: async () => answer }).pickPath({
          repo: path,
        });
      } finally {
        repository.dispose();
      }
    };
    // 列表按路径排序：f1、src、src/a.ts。
    expect(await run(1)).toBe("src");
    expect(await run(undefined)).toBeNull();
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
    const [sides] = await open(repo, "both.txt");
    expect(sides).toMatchObject({
      base: { kind: DiffSideKind.Stage, stage: IndexStage.Base, path: "both.txt" },
      current: { kind: DiffSideKind.Stage, stage: IndexStage.Ours, path: "both.txt" },
      incoming: { kind: DiffSideKind.Stage, stage: IndexStage.Theirs, path: "both.txt" },
      output: "both.txt",
    });
  });

  it("两边都新增的没有基准：基准给空", async () => {
    const [sides] = await open(stashConflict("merge-editor-added"), "added.txt");
    expect(sides?.base).toEqual({ kind: DiffSideKind.Missing, path: "added.txt" });
  });

  it("没有冲突的文件：报给用户，不打开", async () => {
    await expect(open(stashConflict("merge-editor-clean"), "clean.txt")).rejects.toThrow(
      UserFacingError,
    );
  });
});

describe("解决冲突：markResolved / removeConflictFile / resolveDeletion / deleteUntracked", () => {
  afterAll(cleanupTempRepos);
  /** 跑一次，确认框回答 `sure`、选择框回答 `pick`；返回问了几次。 */
  const act = async (
    path: string,
    run: (h: ReturnType<typeof createHandlers>) => Promise<unknown>,
    answers: { sure?: boolean; pick?: number } = {},
  ) => {
    const repository = new Repository(plainLocation(path), cli);
    let asked = 0;
    try {
      await run(
        createHandlers(repository, {
          ...NO_UI,
          confirm: async () => {
            asked++;
            return answers.sure ?? false;
          },
          choose: async () => {
            asked++;
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
    expect(await act(repo, (h) => h.markResolved({ repo, paths: ["both.txt"] }))).toBe(1);
    expect(status(repo, "both.txt")).toBe("UU both.txt");
  });

  it("没有冲突标记了：直接标记，移出冲突", async () => {
    const repo = stashConflict("resolve-clean");
    writeFileSync(join(repo, "both.txt"), "merged\n");
    expect(await act(repo, (h) => h.markResolved({ repo, paths: ["both.txt"] }))).toBe(0);
    expect(status(repo, "both.txt")).toBe("M  both.txt");
  });

  it("双击一边删了的：选 Keep 留下工作区那份，选 Delete File 删掉", async () => {
    const kept = stashConflict("resolve-keep");
    await act(kept, (h) => h.resolveDeletion({ repo: kept, path: "gone.txt" }), { pick: 0 });
    expect(status(kept, "gone.txt")).toBe("");
    const removed = stashConflict("resolve-delete");
    await act(removed, (h) => h.resolveDeletion({ repo: removed, path: "gone.txt" }), { pick: 1 });
    expect(status(removed, "gone.txt")).toBe("D  gone.txt");
  });

  it("右键 Delete File：删掉并移出冲突", async () => {
    const repo = stashConflict("resolve-remove");
    await act(repo, (h) => h.removeConflictFile({ repo, paths: ["gone.txt"] }));
    expect(status(repo, "gone.txt")).toBe("D  gone.txt");
  });

  it("未跟踪文件 Add to Git：放进暂存区，不确认，磁盘上的内容还在", async () => {
    const repo = makeTempRepo("add-untracked");
    writeFileSync(join(repo, "junk.txt"), "x\n");
    expect(await act(repo, (h) => h.addUntracked({ repo, paths: ["junk.txt"] }))).toBe(0);
    expect(status(repo, "junk.txt")).toBe("A  junk.txt");
    expect(readFileSync(join(repo, "junk.txt"), "utf8")).toBe("x\n");
  });

  it("删未跟踪文件：确认后从磁盘删掉，取消就留着", async () => {
    const repo = makeTempRepo("delete-untracked");
    writeFileSync(join(repo, "junk.txt"), "x");
    await act(repo, (h) => h.deleteUntracked({ repo, paths: ["junk.txt"] }));
    expect(status(repo, "junk.txt")).toBe("?? junk.txt");
    await act(repo, (h) => h.deleteUntracked({ repo, paths: ["junk.txt"] }), { sure: true });
    expect(status(repo, "junk.txt")).toBe("");
  });
});

describe("Commit 面板的批量：Mark as Resolved、Delete File、Add to Git、Delete", () => {
  afterAll(cleanupTempRepos);
  /** 跑一次，确认框都回答 `sure`；返回问过的话（带名单的写在后面）。 */
  const act = async (
    path: string,
    run: (h: ReturnType<typeof createHandlers>) => Promise<unknown>,
    sure: boolean,
  ) => {
    const repository = new Repository(plainLocation(path), cli);
    const asked: string[] = [];
    try {
      await run(
        createHandlers(repository, {
          ...NO_UI,
          confirm: async (message, _action, names) => {
            asked.push(names === undefined ? message : `${message} [${names.join(", ")}]`);
            return sure;
          },
        }),
      );
      return asked;
    } finally {
      repository.dispose();
    }
  };
  const status = (repo: string) => git(repo, ["status", "--porcelain"]).trimEnd().split("\n");

  /** 停在 merge 冲突：m1、m2、m3 两边都改，gone1、gone2 被 feature 删了、main 改了。 */
  const conflicted = (name: string): string => {
    const repo = makeTempRepo(name);
    const files = ["m1", "m2", "m3", "gone1", "gone2"];
    for (const file of files) writeFileSync(join(repo, file), "base\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-qm", "base"]);
    git(repo, ["switch", "-q", "-c", "feature"]);
    for (const file of ["m1", "m2", "m3"]) writeFileSync(join(repo, file), "feature\n");
    git(repo, ["rm", "-q", "gone1", "gone2"]);
    git(repo, ["commit", "-qam", "feature"]);
    git(repo, ["switch", "-q", "main"]);
    for (const file of files) writeFileSync(join(repo, file), "main\n");
    git(repo, ["commit", "-qam", "main"]);
    expect(() => git(repo, ["merge", "--no-edit", "feature"])).toThrow();
    return repo;
  };

  it("Mark as Resolved 一批：没有冲突标记的直接标记，有的收在一起问一次；取消就只是它们不标记", async () => {
    const repo = conflicted("mark-batch");
    writeFileSync(join(repo, "m3"), "merged\n");
    const asked = await act(
      repo,
      (h) => h.markResolved({ repo, paths: ["m1", "m2", "m3"] }),
      false,
    );
    expect(asked).toEqual([
      "2 files still contain conflict markers. Mark them as resolved anyway? [m1, m2]",
    ]);
    expect(status(repo)).toEqual(expect.arrayContaining(["UU m1", "UU m2", "M  m3"]));
  });

  it("Mark as Resolved 一批、确认：全都标记", async () => {
    const repo = conflicted("mark-batch-sure");
    await act(repo, (h) => h.markResolved({ repo, paths: ["m1", "m2"] }), true);
    expect(status(repo)).toEqual(expect.arrayContaining(["M  m1", "M  m2"]));
  });

  it("Delete File 一批：一条 git rm，不问", async () => {
    const repo = conflicted("remove-batch");
    const asked = await act(
      repo,
      (h) => h.removeConflictFile({ repo, paths: ["gone1", "gone2"] }),
      false,
    );
    expect(asked).toEqual([]);
    expect(status(repo)).toEqual(expect.arrayContaining(["D  gone1", "D  gone2"]));
  });

  it("Add to Git 一批：不问", async () => {
    const repo = makeTempRepo("add-batch");
    writeFileSync(join(repo, "a.txt"), "a\n");
    mkdirSync(join(repo, "dir"));
    writeFileSync(join(repo, "dir", "b.txt"), "b\n");
    expect(
      await act(repo, (h) => h.addUntracked({ repo, paths: ["a.txt", "dir/b.txt"] }), false),
    ).toEqual([]);
    expect(status(repo)).toEqual(["A  a.txt", "A  dir/b.txt"]);
  });

  it("Delete 一批未跟踪文件：问一次、列出名字，确认后都删", async () => {
    const repo = makeTempRepo("delete-untracked-batch");
    writeFileSync(join(repo, "a.txt"), "a\n");
    mkdirSync(join(repo, "dir"));
    writeFileSync(join(repo, "dir", "b.txt"), "b\n");
    const asked = await act(
      repo,
      (h) => h.deleteUntracked({ repo, paths: ["a.txt", "dir/b.txt"] }),
      true,
    );
    expect(asked).toEqual(["Delete 2 files? This cannot be undone. [a.txt, b.txt]"]);
    expect(git(repo, ["status", "--porcelain"]).trim()).toBe("");
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
    let asked = 0;
    const ui: HandlerUi = {
      ...NO_UI,
      confirm: async () => {
        asked++;
        return sure;
      },
    };
    try {
      await run(createHandlers(repository, ui));
      return asked;
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
    expect(await act(kept, (h) => h.abortOperation({ repo: kept }), false)).toBe(1);
    expect(existsSync(join(kept, ".git", "MERGE_HEAD"))).toBe(true);

    const dropped = conflictedMerge("op-abort");
    expect(await act(dropped, (h) => h.abortOperation({ repo: dropped }))).toBe(1);
    expect(existsSync(join(dropped, ".git", "MERGE_HEAD"))).toBe(false);
  });

  it("冲突解决后继续：用说明框里的那句提交，不带走别的改动", async () => {
    const repo = conflictedMerge("op-continue");
    writeFileSync(join(repo, "f.txt"), "resolved\n");
    git(repo, ["add", "f.txt"]);
    // 继续不能 git add 其它文件：这个已跟踪的改动该留在工作区。
    writeFileSync(join(repo, "f1"), "still dirty\n");
    await act(repo, (h) => h.continueOperation({ repo, message: "edited merge" }));
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
      await act(repo, (h) => h.continueOperation({ repo, message: "edited pick" }));
      const second = await handlers.getOperation({ repo });
      expect(second?.kind).toBe(OperationKind.CherryPick);
      expect(second?.id).not.toBe(first?.id);
      expect(git(repo, ["log", "-1", "--format=%s"]).trim()).toBe("edited pick");
    } finally {
      repository.dispose();
    }
  });

  it("没有进行中的操作：报给用户，不跑 git", async () => {
    const repo = makeTempRepo("op-none");
    await expect(act(repo, (h) => h.continueOperation({ repo, message: "x" }))).rejects.toThrow(
      UserFacingError,
    );
    await expect(act(repo, (h) => h.abortOperation({ repo }))).rejects.toThrow(UserFacingError);
  });
});

describe("分支右键：合并与变基", () => {
  afterAll(cleanupTempRepos);

  const run = async (
    repo: string,
    call: (handlers: ReturnType<typeof createHandlers>) => Promise<unknown>,
  ) => {
    const repository = new Repository(plainLocation(repo), cli);
    try {
      await call(createHandlers(repository, NO_UI));
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
    await run(repo, (h) => h.merge({ repo, start: "refs/heads/feature", startName: "feature" }));
    expect(git(repo, ["rev-parse", "main"])).toBe(git(repo, ["rev-parse", "feature"]));
    expect(git(repo, ["status", "--porcelain"]).trimEnd()).toBe(" M f1");
  });

  it("已经包含：不再合一次", async () => {
    const repo = ahead("merge-uptodate");
    await run(repo, (h) => h.merge({ repo, start: "refs/heads/feature", startName: "feature" }));
    const before = git(repo, ["rev-parse", "HEAD"]);
    await run(repo, (h) => h.merge({ repo, start: "refs/heads/feature", startName: "feature" }));
    expect(git(repo, ["rev-parse", "HEAD"])).toBe(before);
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
    await run(repo, (h) => h.merge({ repo, start: "refs/heads/feature", startName: "feature" }));
    expect(git(repo, ["log", "-1", "--format=%s"]).trim()).toBe("Merge branch 'feature'");
  });

  it("合出冲突：停住，不弹确认", async () => {
    const repo = bothTouched("merge-stop");
    await run(repo, (h) => h.merge({ repo, start: "refs/heads/feature", startName: "feature" }));
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
    ).rejects.toThrow();
    expect(existsSync(join(repo, ".git", "MERGE_HEAD"))).toBe(false);
  });

  it("变基到远程分支记录，已跟踪的改动取回", async () => {
    const repo = ahead("rebase-keep");
    git(repo, ["update-ref", "refs/remotes/origin/feature", "refs/heads/feature"]);
    writeFileSync(join(repo, "f1"), "dirty\n");
    await run(repo, (h) =>
      h.rebase({ repo, start: "refs/remotes/origin/feature", startName: "origin/feature" }),
    );
    expect(git(repo, ["rev-parse", "main"])).toBe(git(repo, ["rev-parse", "feature"]));
    expect(git(repo, ["status", "--porcelain"]).trimEnd()).toBe(" M f1");
  });

  it("已经在目标上：什么都不动", async () => {
    const repo = ahead("rebase-uptodate");
    await run(repo, (h) => h.rebase({ repo, start: "refs/heads/feature", startName: "feature" }));
    const before = git(repo, ["rev-parse", "HEAD"]);
    await run(repo, (h) => h.rebase({ repo, start: "refs/heads/feature", startName: "feature" }));
    expect(git(repo, ["rev-parse", "HEAD"])).toBe(before);
  });

  /** rebase 停在半路：git 2.26 起默认 merge 后端（`rebase-merge/`），之前是 apply 后端（`rebase-apply/`）。 */
  const rebasing = (repo: string) =>
    existsSync(join(repo, ".git", "rebase-merge")) ||
    existsSync(join(repo, ".git", "rebase-apply"));

  it("变基冲突：停住", async () => {
    const repo = bothTouched("rebase-stop");
    await run(repo, (h) => h.rebase({ repo, start: "refs/heads/feature", startName: "feature" }));
    expect(rebasing(repo)).toBe(true);
  });

  it("取回暂存的改动冲突：变基已经结束，工作区留下冲突", async () => {
    const repo = makeTempRepo("rebase-stash");
    git(repo, ["switch", "-q", "-c", "feature"]);
    writeFileSync(join(repo, "f1"), "feature\n");
    git(repo, ["commit", "-qam", "feature"]);
    git(repo, ["switch", "-q", "main"]);
    writeFileSync(join(repo, "f1"), "dirty\n");
    await run(repo, (h) => h.rebase({ repo, start: "refs/heads/feature", startName: "feature" }));
    expect(rebasing(repo)).toBe(false);
    expect(existsSync(join(repo, ".git", "MERGE_HEAD"))).toBe(false);
    expect(git(repo, ["status", "--porcelain"]).trimEnd()).toBe("UU f1");
    expect(git(repo, ["rev-parse", "main"])).toBe(git(repo, ["rev-parse", "feature"]));
  });
});

describe("提交右键：cherry-pick、revert、变基到这条", () => {
  afterAll(cleanupTempRepos);

  /** `messages` 收下每次的完成消息。 */
  const run = async (
    repo: string,
    call: (handlers: ReturnType<typeof createHandlers>) => Promise<unknown>,
    messages: string[] = [],
  ) => {
    const repository = new Repository(plainLocation(repo), cli);
    try {
      await call(
        createHandlers(repository, {
          ...NO_UI,
          withProgress: async (_title, task, done) => {
            const value = await task();
            messages.push(done(value));
            return value;
          },
        }),
      );
    } finally {
      repository.dispose();
    }
  };

  /** 在当前分支上提交一个新文件（说明就是文件名），返回这条提交的 hash。 */
  const commitFile = (repo: string, file: string, content: string): string => {
    writeFileSync(join(repo, file), content);
    git(repo, ["add", file]);
    git(repo, ["commit", "-qm", file]);
    return git(repo, ["rev-parse", "HEAD"]).trim();
  };
  const subjects = (repo: string, count: number): string[] =>
    git(repo, ["log", `-${count}`, "--format=%s"])
      .trim()
      .split("\n");
  const sequencer = (repo: string): boolean => existsSync(join(repo, ".git", "sequencer"));

  const head = (repo: string): string => git(repo, ["rev-parse", "HEAD"]).trim();

  it("摘一条不相关的提交，工作区里不相关的改动留着", async () => {
    const repo = makeTempRepo("pick-ok");
    git(repo, ["switch", "-q", "-c", "feature"]);
    writeFileSync(join(repo, "extra.txt"), "extra\n");
    git(repo, ["add", "extra.txt"]);
    git(repo, ["commit", "-qm", "feature"]);
    const hash = head(repo);
    git(repo, ["switch", "-q", "main"]);
    writeFileSync(join(repo, "f1"), "dirty\n");
    await run(repo, (h) => h.cherryPick({ repo, hashes: [hash] }));
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
    await run(repo, (h) => h.cherryPick({ repo, hashes: [hash] }));
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
    await expect(run(repo, (h) => h.cherryPick({ repo, hashes: [hash] }))).rejects.toThrow();
    expect(existsSync(join(repo, ".git", "CHERRY_PICK_HEAD"))).toBe(false);
  });

  it("改动已经在了：自动跳过，不停在半路", async () => {
    const repo = makeTempRepo("pick-empty");
    git(repo, ["switch", "-q", "-c", "feature"]);
    const hash = commitFile(repo, "extra.txt", "extra\n");
    git(repo, ["switch", "-q", "main"]);
    await run(repo, (h) => h.cherryPick({ repo, hashes: [hash] }));
    const messages: string[] = [];
    await run(repo, (h) => h.cherryPick({ repo, hashes: [hash] }), messages);
    expect(messages).toEqual(["Skipped 1 already applied"]);
    expect(existsSync(join(repo, ".git", "CHERRY_PICK_HEAD"))).toBe(false);
    expect(subjects(repo, 2)).toEqual(["extra.txt", "init"]);
  });

  it("一串：按给的顺序摘，不重排", async () => {
    const repo = makeTempRepo("pick-order");
    git(repo, ["switch", "-q", "-c", "feature"]);
    const a = commitFile(repo, "a.txt", "a\n");
    const b = commitFile(repo, "b.txt", "b\n");
    git(repo, ["switch", "-q", "main"]);
    const messages: string[] = [];
    await run(repo, (h) => h.cherryPick({ repo, hashes: [b, a] }), messages);
    expect(subjects(repo, 2)).toEqual(["a.txt", "b.txt"]);
    expect(messages).toEqual(["Cherry-picked 2 commits"]);
  });

  it("一串里有已经摘过的：跳过它，接着摘后面的", async () => {
    const repo = makeTempRepo("pick-skip");
    git(repo, ["switch", "-q", "-c", "feature"]);
    const a = commitFile(repo, "a.txt", "a\n");
    const b = commitFile(repo, "b.txt", "b\n");
    git(repo, ["switch", "-q", "main"]);
    git(repo, ["cherry-pick", a]);
    const messages: string[] = [];
    await run(repo, (h) => h.cherryPick({ repo, hashes: [a, b] }), messages);
    expect(messages).toEqual(["Cherry-picked 1 commit, skipped 1 already applied"]);
    expect(subjects(repo, 2)).toEqual(["b.txt", "a.txt"]);
    expect(sequencer(repo)).toBe(false);
  });

  it("一串停在冲突：继续之后接着摘剩下的", async () => {
    const repo = makeTempRepo("pick-batch-stop");
    git(repo, ["switch", "-q", "-c", "feature"]);
    writeFileSync(join(repo, "f1"), "feature\n");
    git(repo, ["commit", "-qam", "feature f1"]);
    const clash = head(repo);
    const b = commitFile(repo, "b.txt", "b\n");
    git(repo, ["switch", "-q", "main"]);
    writeFileSync(join(repo, "f1"), "main\n");
    git(repo, ["commit", "-qam", "main f1"]);
    const messages: string[] = [];
    await run(repo, (h) => h.cherryPick({ repo, hashes: [clash, b] }), messages);
    expect(messages).toEqual(["Stopped for conflicts"]);
    writeFileSync(join(repo, "f1"), "resolved\n");
    git(repo, ["add", "f1"]);
    await run(repo, (h) => h.continueOperation({ repo, message: "resolved f1" }));
    expect(subjects(repo, 2)).toEqual(["b.txt", "resolved f1"]);
    expect(sequencer(repo)).toBe(false);
  });

  it("合并提交：git 拒绝，cherry-pick 没有开始", async () => {
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
    await expect(run(repo, (h) => h.cherryPick({ repo, hashes: [hash] }))).rejects.toThrow();
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
    await run(repo, (h) => h.revert({ repo, hashes: [hash] }));
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
    await run(repo, (h) => h.revert({ repo, hashes: [hash] }));
    expect(existsSync(join(repo, ".git", "REVERT_HEAD"))).toBe(true);
  });

  it("一串停在冲突、解决时留了当前分支那一边：继续后跳过这条，接着摘剩下的", async () => {
    const repo = makeTempRepo("pick-resolve-ours");
    git(repo, ["switch", "-q", "-c", "feature"]);
    writeFileSync(join(repo, "f1"), "feature\n");
    git(repo, ["commit", "-qam", "feature f1"]);
    const clash = head(repo);
    const b = commitFile(repo, "b.txt", "b\n");
    git(repo, ["switch", "-q", "main"]);
    writeFileSync(join(repo, "f1"), "main\n");
    git(repo, ["commit", "-qam", "main f1"]);
    await run(repo, (h) => h.cherryPick({ repo, hashes: [clash, b] }));
    writeFileSync(join(repo, "f1"), "main\n");
    git(repo, ["add", "f1"]);
    const messages: string[] = [];
    await run(repo, (h) => h.continueOperation({ repo, message: "feature f1" }), messages);
    expect(messages).toEqual(["Cherry-pick completed, skipped 1 already applied"]);
    expect(subjects(repo, 2)).toEqual(["b.txt", "main f1"]);
    expect(existsSync(join(repo, ".git", "CHERRY_PICK_HEAD"))).toBe(false);
    expect(sequencer(repo)).toBe(false);
  });

  it("反向提交冲突、解决时留了当前分支那一边：继续后跳过，不停在半路", async () => {
    const repo = makeTempRepo("revert-resolve-ours");
    writeFileSync(join(repo, "f1"), "second\n");
    git(repo, ["commit", "-qam", "second"]);
    const hash = head(repo);
    writeFileSync(join(repo, "f1"), "third\n");
    git(repo, ["commit", "-qam", "third"]);
    await run(repo, (h) => h.revert({ repo, hashes: [hash] }));
    writeFileSync(join(repo, "f1"), "third\n");
    git(repo, ["add", "f1"]);
    const messages: string[] = [];
    await run(repo, (h) => h.continueOperation({ repo, message: "x" }), messages);
    expect(messages).toEqual(["Revert completed, skipped 1 already reverted"]);
    expect(existsSync(join(repo, ".git", "REVERT_HEAD"))).toBe(false);
    expect(subjects(repo, 1)).toEqual(["third"]);
  });

  it("撤一条已经撤过的：什么都不动，说跳过了，不报错", async () => {
    const repo = makeTempRepo("revert-empty");
    const hash = commitFile(repo, "a.txt", "a\n");
    git(repo, ["revert", "--no-edit", hash]);
    const messages: string[] = [];
    await run(repo, (h) => h.revert({ repo, hashes: [hash] }), messages);
    expect(messages).toEqual(["Skipped 1 already reverted"]);
    expect(subjects(repo, 1)).toEqual(['Revert "a.txt"']);
  });

  it("一串里有已经撤过的：跳过它，接着撤后面的，不留下 sequencer", async () => {
    const repo = makeTempRepo("revert-skip");
    const a = commitFile(repo, "a.txt", "a\n");
    const b = commitFile(repo, "b.txt", "b\n");
    git(repo, ["revert", "--no-edit", a]);
    const messages: string[] = [];
    await run(repo, (h) => h.revert({ repo, hashes: [b, a] }), messages);
    expect(messages).toEqual(["Reverted 1 commit, skipped 1 already reverted"]);
    expect(subjects(repo, 1)).toEqual(['Revert "b.txt"']);
    expect(sequencer(repo)).toBe(false);
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
    await run(repo, (h) => h.rebase({ repo, start: hash, startName: hash.slice(0, 7) }));
    expect(head(repo)).toBe(hash);
    expect(git(repo, ["status", "--porcelain"]).trimEnd()).toBe(" M f1");
  });
});

describe("handlers.resetTo", () => {
  afterAll(cleanupTempRepos);
  const reset = async (path: string, hash: string, pick: number | undefined) => {
    const repository = new Repository(plainLocation(path), cli);
    try {
      await createHandlers(repository, { ...NO_UI, choose: async () => pick }).resetTo({
        repo: path,
        hash,
      });
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
    const closed: DialogKind[] = [];
    try {
      await createHandlers(repository, {
        ...NO_UI,
        closeDialog: (dialog) => void closed.push(dialog),
      }).reword({ repo: path, hash, message });
      return closed;
    } finally {
      repository.dispose();
    }
  };

  it("关掉对话框，改写", async () => {
    const repo = makeTempRepo("reword-handler");
    const hash = git(repo, ["rev-parse", "HEAD"]).trim();
    expect(await reword(repo, hash, "renamed")).toEqual([DialogKind.Reword]);
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
      ).rejects.toThrow(UserFacingError);
    } finally {
      repository.dispose();
    }
    expect(closed).toEqual([]);
    expect(git(repo, ["rev-parse", "HEAD"]).trim()).toBe(head);
  });
});
