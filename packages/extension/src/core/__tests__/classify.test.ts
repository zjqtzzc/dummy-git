import { describe, expect, it } from "vitest";
import { classifyGitPath } from "../classify.js";
import { GitDomain } from "../domains.js";

describe("classifyGitPath：M6 第 1 步实测抓到的真实路径", () => {
  // 这份路径清单来自 scripts/demo-watch-timing.mjs 对一次真实 `commit` 的抓取
  // （见 .notes/NFR.md §7）：27 个原始事件，滤噪后剩 10 个，5 个有效路径。
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
    // stash 变更被当成 refs 处理，触发 1.9 秒的全量重拉而不是几毫秒的 stash 重拉。
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
    for (const p of ["description", "shallow", "hooks/pre-commit", "info/exclude"]) {
      expect([p, classifyGitPath(p)]).toEqual([p, []]);
    }
  });
});
