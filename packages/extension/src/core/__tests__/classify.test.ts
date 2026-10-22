import { GitDomain } from "@dummy-git/shared";
import { describe, expect, it } from "vitest";
import { classifyGitPath } from "../classify.js";

describe("classifyGitPath：实测抓到的真实路径", () => {
  // 这份路径清单来自 scripts/demo-watch-timing.mjs 对一次真实 `commit` 的抓取。
  it("噪声全部丢弃", () => {
    for (const p of [
      "index.lock",
      "objects/5e",
      "objects/5e/a2ed416fbd4a4cbe227b75fe255dd7fa6bd4d6",
      "objects/c0",
      "next-index-3258498.lock",
      "HEAD.lock",
      "objects/e3",
      "objects/maintenance.lock",
    ]) {
      expect([p, classifyGitPath(p)]).toEqual([p, []]);
    }
  });

  it("一次 commit 的有效路径合并后 = { refs, worktree }", () => {
    const paths = [
      "COMMIT_EDITMSG",
      "logs/HEAD",
      "logs/refs/heads/main",
      "refs/heads/main",
      "index",
    ];
    const union = new Set(paths.flatMap((p) => classifyGitPath(p)));
    expect(union).toEqual(new Set([GitDomain.Refs, GitDomain.Worktree]));
  });
});

describe("classifyGitPath：顺序敏感的边界", () => {
  it("refs/stash 不被 refs/ 前缀抢走", () => {
    // 顺序错了不报错，表现是「性能莫名其妙地差」——
    // stash 变更被当成 refs 处理，触发全量重拉，而不是轻得多的 stash 重拉。
    expect(classifyGitPath("refs/stash")).toEqual([GitDomain.Stash, GitDomain.Worktree]);
    expect(classifyGitPath("logs/refs/stash")).toEqual([GitDomain.Stash, GitDomain.Worktree]);
  });

  it("index 只给 Worktree，绝不给 Refs", () => {
    // status 自己会回写 index 刷新 stat 缓存；算进 Refs 就会变成
    // status → 写 index → 重拉 → 又跑 status 的回路。
    const domains = classifyGitPath("index");
    expect(domains).toEqual([GitDomain.Worktree]);
    expect(domains).not.toContain(GitDomain.Refs);
  });
});

describe("classifyGitPath：进行中的操作", () => {
  it("MERGE_HEAD → operation + worktree", () => {
    expect(classifyGitPath("MERGE_HEAD")).toEqual([GitDomain.Operation, GitDomain.Worktree]);
  });

  it("rebase-merge/** → 三个域都动", () => {
    expect(classifyGitPath("rebase-merge/done")).toEqual([
      GitDomain.Operation,
      GitDomain.Refs,
      GitDomain.Worktree,
    ]);
  });
});

describe("classifyGitPath：其余 refs", () => {
  it("packed-refs 不能漏（git gc 之后 ref 从 refs/* 搬进这里）", () => {
    expect(classifyGitPath("packed-refs")).toEqual([GitDomain.Refs]);
  });

  it("config / FETCH_HEAD / worktrees 各归其位", () => {
    expect(classifyGitPath("config")).toEqual([GitDomain.Refs]);
    expect(classifyGitPath("FETCH_HEAD")).toEqual([GitDomain.Refs]);
    expect(classifyGitPath("worktrees/wt1/HEAD")).toEqual([GitDomain.Refs, GitDomain.Worktree]);
  });
});

describe("classifyGitPath：认不出就丢弃，不兜底刷新", () => {
  it("陌生路径", () => {
    // 注意 `shallow` 不在这里——它改的是祖先关系，归 Refs，见下面那组。
    for (const p of ["description", "hooks/pre-commit", "info/exclude", "COMMIT_EDITMSG.swp"]) {
      expect([p, classifyGitPath(p)]).toEqual([p, []]);
    }
  });
});

describe("classifyGitPath：容易漏的几类路径", () => {
  it("sequencer/** → operation——漏了是功能漏判，不是性能问题", () => {
    // 多提交的 cherry-pick / revert 用 .git/sequencer/ 记录序列进度。
    // 不认它，界面上看不出「正在 cherry-pick，还剩 3 个」。
    for (const p of ["sequencer/todo", "sequencer/opts", "sequencer/head"]) {
      expect([p, classifyGitPath(p)]).toEqual([
        p,
        [GitDomain.Operation, GitDomain.Refs, GitDomain.Worktree],
      ]);
    }
  });

  it("shallow / refs/replace → refs：ref 指向没动，但祖先关系变了", () => {
    // shallow 是浅克隆的截断点，refs/replace 让 git 遍历时替换某个提交。
    // 所有分支的指向可以完全没变，而提交图的形状已经不同。
    expect(classifyGitPath("shallow")).toEqual([GitDomain.Refs]);
    expect(classifyGitPath("refs/replace/abc123")).toEqual([GitDomain.Refs]);
  });

  it("fsmonitor--daemon/** 是噪声——.lock 规则挡不住它", () => {
    for (const p of ["fsmonitor--daemon/ipc", "fsmonitor--daemon/cookies/x"]) {
      expect([p, classifyGitPath(p)]).toEqual([p, []]);
    }
  });

  it("git-rebase-todo 是噪声——用户每存一次盘就是一个事件", () => {
    // 它是用户在编辑器里改的文件，rebase 的真实进展由 rebase-merge/ 下的
    // 兄弟文件反映。不挡的话，编辑 todo 的整个过程都在刷界面。
    expect(classifyGitPath("rebase-merge/git-rebase-todo")).toEqual([]);
    expect(classifyGitPath("rebase-merge/git-rebase-todo.backup")).toEqual([]);
  });

  it("但 rebase-merge/ 下的其他文件仍然要认", () => {
    // 上一条挡的是 todo 本身，不能把整个 rebase-merge/ 一起挡掉——
    // 那会让 rebase 的进展完全不可见。
    expect(classifyGitPath("rebase-merge/done")).toEqual([
      GitDomain.Operation,
      GitDomain.Refs,
      GitDomain.Worktree,
    ]);
  });
});
