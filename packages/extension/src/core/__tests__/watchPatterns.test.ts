import { describe, expect, it } from "vitest";
import { classifyGitPath } from "../classify.js";
import { DOT_GIT_GLOB, DOT_GIT_GLOB_COMMON, DOT_GIT_GLOB_WORKTREE } from "../watchPatterns.js";

/**
 * 极简 glob 匹配，只支持本文件用到的 `{a,b}` 与 `**` / `*`。
 *
 * 一次扫描逐段翻译，不做「先替换成占位符再换回来」——
 * 那种写法要挑一个不会与输入冲突的占位符，是自找的麻烦。
 */
function matches(glob: string, path: string): boolean {
  const alternatives = glob.replace(/^\{|\}$/g, "").split(",");
  return alternatives.some((alt) => {
    let source = "";
    for (let i = 0; i < alt.length; i++) {
      if (alt.startsWith("**", i)) {
        source += ".*";
        i++; // 跳过第二个 *
      } else if (alt[i] === "*") {
        source += "[^/]*";
      } else {
        source += alt[i]?.replace(/[.+^${}()|[\]\\]/, "\\$&") ?? "";
      }
    }
    return new RegExp(`^${source}$`).test(path);
  });
}

describe("DOT_GIT_GLOB：该收的必须收到", () => {
  // 这些路径在 classify.ts 里都有明确归属——订阅层漏了它们，
  // 分类表写得再对也没用，事件根本不会到达。
  const mustMatch = [
    "index",
    "HEAD",
    "ORIG_HEAD",
    "FETCH_HEAD",
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "REBASE_HEAD",
    "MERGE_MSG",
    "rebase-merge/done",
    "rebase-apply/next",
    "sequencer/todo",
    "config",
    "packed-refs",
    "shallow",
    "info/exclude",
    "refs/heads/main",
    "refs/remotes/origin/main",
    "refs/stash",
    "refs/tags/v1",
    "logs/HEAD",
    "logs/refs/stash",
  ];

  for (const p of mustMatch) {
    it(p, () => {
      expect([p, matches(DOT_GIT_GLOB, p)]).toEqual([p, true]);
    });
  }
});

describe("DOT_GIT_GLOB：白名单挡住 objects/", () => {
  it("objects/** 根本不会到达——这是白名单存在的全部理由", () => {
    // 一次 fetch 能刷出上千个 object 事件。全订阅再过滤是收下来再丢掉。
    for (const p of ["objects/ab", "objects/ab/cdef0123", "objects/pack/pack-x.idx"]) {
      expect([p, matches(DOT_GIT_GLOB, p)]).toEqual([p, false]);
    }
  });

  it("hooks/ 与 lfs/ 也不在白名单里", () => {
    expect(matches(DOT_GIT_GLOB, "hooks/pre-commit")).toBe(false);
    expect(matches(DOT_GIT_GLOB, "lfs/objects/x")).toBe(false);
  });
});

describe("白名单与噪声规则是两道独立的关卡", () => {
  it("refs/ 下的锁文件能穿过白名单，靠噪声规则挡住", () => {
    // glob 表达不了 `*.lock` 这类跨目录的后缀规则：`refs/**` 必须放行
    // refs 下的一切，而 git 创建 ref 时会先写 `refs/heads/xxx.lock`
    // （M4 的 ref 锁测试用的就是这个真实路径）。
    // 所以 classify.ts 的噪声规则不能删——这条测试钉住这件事。
    expect(matches(DOT_GIT_GLOB, "refs/heads/main.lock")).toBe(true); // ← 穿过白名单
    expect(classifyGitPath("refs/heads/main.lock")).toEqual([]); // ← 被噪声规则挡住

    // 反过来：白名单能挡住的就不必劳烦噪声规则，两道关卡各有分工
    expect(matches(DOT_GIT_GLOB, "index.lock")).toBe(false); // 白名单里是精确的 `index`
  });
});

describe("worktree / common 两份白名单合起来等于完整白名单", () => {
  it("拆分不丢东西", () => {
    const merged = new Set([
      ...DOT_GIT_GLOB_WORKTREE.replace(/^\{|\}$/g, "").split(","),
      ...DOT_GIT_GLOB_COMMON.replace(/^\{|\}$/g, "").split(","),
    ]);
    const full = new Set(DOT_GIT_GLOB.replace(/^\{|\}$/g, "").split(","));
    expect(merged).toEqual(full);
  });
});
