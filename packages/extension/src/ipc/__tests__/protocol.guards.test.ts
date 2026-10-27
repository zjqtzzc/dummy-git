import { type CommandName, DiffOpenMode, DiffSideKind, PushTagMode } from "@dummy-git/shared";
import { describe, expect, it } from "vitest";
import { parseParams } from "../protocol.guards.js";

const HASH = "f".repeat(40);
const valid = {
  repo: "/r",
  left: { kind: DiffSideKind.Missing, path: "a.ts" },
  right: { kind: DiffSideKind.Revision, hash: HASH, path: "a.ts" },
  mode: DiffOpenMode.Follow,
};

describe("openDiff 的参数校验：两边会拼进 git 命令行，深验", () => {
  it("合法参数原样通过", () => {
    expect(parseParams("openDiff", valid)).toEqual(valid);
  });

  it.each([
    ["不认识的 kind", { ...valid, left: { kind: "stage", path: "a.ts" } }],
    ["Revision 缺 hash", { ...valid, right: { kind: DiffSideKind.Revision, path: "a.ts" } }],
    ["path 不是字符串", { ...valid, left: { kind: DiffSideKind.Missing, path: 1 } }],
    ["不认识的 mode", { ...valid, mode: "peek" }],
    ["缺 repo", { left: valid.left, right: valid.right, mode: valid.mode }],
  ])("拒绝：%s", (_name, raw) => {
    expect(parseParams("openDiff", raw)).toBeUndefined();
  });
});

describe("commit 的参数校验", () => {
  it("合法参数原样通过", () => {
    const raw = { repo: "/r", message: "msg", paths: ["a.ts"] };
    expect(parseParams("commit", raw)).toEqual(raw);
  });

  it("拒绝空的路径列表：commit --only 不带路径会提交整个暂存区", () => {
    expect(parseParams("commit", { repo: "/r", message: "msg", paths: [] })).toBeUndefined();
  });

  it("拒绝带 .. 的路径：会走出仓库", () => {
    expect(
      parseParams("commit", { repo: "/r", message: "msg", paths: ["a.ts", "../outside"] }),
    ).toBeUndefined();
  });
});

describe("amend 的参数校验", () => {
  it("路径可以为空：只改说明", () => {
    const raw = { repo: "/r", message: "msg", paths: [] };
    expect(parseParams("amend", raw)).toEqual(raw);
  });
});

describe("getSkeleton、getHeadBases 的 branch", () => {
  it("缺席或完整引用名都收；不是 refs/ 开头的拒收（会进 git 的命令行，`-` 开头会被当成选项）", () => {
    for (const command of ["getSkeleton", "getHeadBases"] as const) {
      const base = command === "getSkeleton" ? { repo: "/r", order: "date" } : { repo: "/r" };
      expect(parseParams(command, base)).toEqual(base);
      expect(parseParams(command, { ...base, branch: "refs/heads/main" })).toEqual({
        ...base,
        branch: "refs/heads/main",
      });
      expect(parseParams(command, { ...base, branch: "--all" })).toBeUndefined();
      expect(parseParams(command, { ...base, branch: "main" })).toBeUndefined();
    }
  });

  it("getSkeleton 的排序：只认两种，缺席或别的值都拒收", () => {
    expect(parseParams("getSkeleton", { repo: "/r", order: "topo" })).toEqual({
      repo: "/r",
      order: "topo",
    });
    expect(parseParams("getSkeleton", { repo: "/r" })).toBeUndefined();
    expect(parseParams("getSkeleton", { repo: "/r", order: "--all" })).toBeUndefined();
  });
});

describe("cherry-pick / revert 的提交", () => {
  const hash = "ab".repeat(20);

  it("收完整 hash 的列表", () => {
    const ok = { repo: "/r", hashes: [hash, "cd".repeat(20)] };
    expect(parseParams("cherryPick", ok)).toEqual(ok);
    expect(parseParams("revert", ok)).toEqual(ok);
  });

  it("空列表、有一个短 hash 或选项：整条拒收", () => {
    expect(parseParams("cherryPick", { repo: "/r", hashes: [] })).toBeUndefined();
    expect(
      parseParams("cherryPick", { repo: "/r", hashes: [hash, hash.slice(0, 7)] }),
    ).toBeUndefined();
    expect(parseParams("revert", { repo: "/r", hashes: ["--abort"] })).toBeUndefined();
  });
});

describe("merge / rebase 的起点", () => {
  it("收完整引用名；短名和选项拒收", () => {
    const ok = { repo: "/r", start: "refs/remotes/origin/feature", startName: "origin/feature" };
    expect(parseParams("merge", ok)).toEqual(ok);
    expect(parseParams("rebase", ok)).toEqual(ok);
    const hash = "a".repeat(40);
    const onto = { repo: "/r", start: hash, startName: hash.slice(0, 7) };
    expect(parseParams("rebase", onto)).toEqual(onto);
    expect(parseParams("rebase", { repo: "/r", start: hash.slice(0, 7), startName: "x" })).toBe(
      undefined,
    );
    expect(
      parseParams("merge", { repo: "/r", start: "feature", startName: "feature" }),
    ).toBeUndefined();
    expect(
      parseParams("rebase", { repo: "/r", start: "--abort", startName: "feature" }),
    ).toBeUndefined();
    expect(
      parseParams("merge", { repo: "/r", start: "refs/heads/feature", startName: "" }),
    ).toBeUndefined();
  });
});

describe("deleteBranches 的参数", () => {
  it("本地名字的列表与远程分支 { remote, branch } 的列表", () => {
    const ok = { repo: "/r", local: ["feat"], remote: [{ remote: "origin", branch: "fix" }] };
    expect(parseParams("deleteBranches", ok)).toEqual(ok);
  });

  it("一个都没有、远程那项缺字段：拒收", () => {
    expect(parseParams("deleteBranches", { repo: "/r", local: [], remote: [] })).toBeUndefined();
    expect(
      parseParams("deleteBranches", { repo: "/r", local: [], remote: [{ remote: "origin" }] }),
    ).toBeUndefined();
    expect(
      parseParams("deleteBranches", { repo: "/r", local: ["--delete"], remote: [] }),
    ).toBeUndefined();
  });
});

describe("update 的参数", () => {
  it("分支名的列表，至少一个", () => {
    expect(parseParams("update", { repo: "/r", branches: ["main"] })).toEqual({
      repo: "/r",
      branches: ["main"],
    });
    expect(parseParams("update", { repo: "/r", branches: [] })).toBeUndefined();
    expect(parseParams("update", { repo: "/r", branch: "main" })).toBeUndefined();
    expect(parseParams("update", { repo: "/r", branches: ["--all"] })).toBeUndefined();
  });
});

describe("push 的参数", () => {
  const base = { repo: "/r", branch: "feat", remote: "origin", remoteBranch: "feat", force: false };

  it("remoteUrl、tags 都可以不带；带了就要是对的类型", () => {
    expect(parseParams("push", base)).toEqual(base);
    expect(parseParams("push", { ...base, tags: PushTagMode.Follow })).toEqual({
      ...base,
      tags: PushTagMode.Follow,
    });
    expect(parseParams("push", { ...base, remoteUrl: "u" })).toEqual({ ...base, remoteUrl: "u" });
    expect(parseParams("push", { ...base, tags: "everything" })).toBeUndefined();
    expect(parseParams("push", { ...base, remoteUrl: 1 })).toBeUndefined();
    expect(parseParams("push", { ...base, remote: "--force" })).toBeUndefined();
    expect(parseParams("push", { ...base, branch: "-u" })).toBeUndefined();
  });
});

describe("Commit 面板批量命令的参数", () => {
  it("路径的列表，至少一个", () => {
    const commands: readonly CommandName[] = [
      "markResolved",
      "removeConflictFile",
      "addUntracked",
      "deleteUntracked",
    ];
    for (const command of commands) {
      expect(parseParams(command, { repo: "/r", paths: ["a", "b/c"] })).toEqual({
        repo: "/r",
        paths: ["a", "b/c"],
      });
      expect(parseParams(command, { repo: "/r", paths: [] })).toBeUndefined();
      expect(parseParams(command, { repo: "/r", path: "a" })).toBeUndefined();
      expect(parseParams(command, { repo: "/r", paths: ["../outside"] })).toBeUndefined();
    }
  });
});

describe("openFile 的参数校验：路径会拼成磁盘路径", () => {
  it("仓库里的相对路径原样通过", () => {
    expect(parseParams("openFile", { repo: "/r", path: "src/a.ts" })).toEqual({
      repo: "/r",
      path: "src/a.ts",
    });
  });

  it.each([
    ["带 .. 的段", "../outside"],
    ["中间带 ..", "src/../../outside"],
    ["反斜杠分隔的 ..", "src\\..\\..\\outside"],
    ["空串", ""],
  ])("拒绝：%s", (_name, path) => {
    expect(parseParams("openFile", { repo: "/r", path })).toBeUndefined();
  });

  it("文件名里含两个点不算", () => {
    expect(parseParams("openFile", { repo: "/r", path: "a..b/..c" })).toEqual({
      repo: "/r",
      path: "a..b/..c",
    });
  });
});

describe("会拼成磁盘路径的命令：带 .. 的段拒收", () => {
  it.each(["openMergeEditor", "resolveDeletion"] as const)("%s", (command) => {
    expect(parseParams(command, { repo: "/r", path: "src/a.ts" })).toEqual({
      repo: "/r",
      path: "src/a.ts",
    });
    expect(parseParams(command, { repo: "/r", path: "../outside" })).toBeUndefined();
  });

  it("openDiff 的 path", () => {
    expect(
      parseParams("openDiff", {
        ...valid,
        left: { kind: DiffSideKind.WorkingTree, path: "../outside" },
      }),
    ).toBeUndefined();
  });

  it("rollback、stash、amend 的 paths", () => {
    expect(parseParams("rollback", { repo: "/r", paths: ["a.ts"] })).toEqual({
      repo: "/r",
      paths: ["a.ts"],
    });
    expect(parseParams("rollback", { repo: "/r", paths: ["../x"] })).toBeUndefined();
    expect(parseParams("stash", { repo: "/r", paths: [] })).toEqual({ repo: "/r", paths: [] });
    expect(parseParams("stash", { repo: "/r", paths: ["../x"] })).toBeUndefined();
    expect(parseParams("amend", { repo: "/r", message: "m", paths: [] })).toEqual({
      repo: "/r",
      message: "m",
      paths: [],
    });
    expect(parseParams("amend", { repo: "/r", message: "m", paths: ["../x"] })).toBeUndefined();
  });
});

describe("进命令行的 hash：只收完整 hash", () => {
  const hash = "ab".repeat(20);

  it.each(["getCommitFiles", "resetTo", "applyStash", "popStash", "dropStash"] as const)(
    "%s",
    (command) => {
      expect(parseParams(command, { repo: "/r", hash })).toEqual({ repo: "/r", hash });
      expect(parseParams(command, { repo: "/r", hash: "--all" })).toBeUndefined();
      expect(parseParams(command, { repo: "/r", hash: hash.slice(0, 7) })).toBeUndefined();
    },
  );

  it("getCommitDetails 的列表：有一个不是完整 hash 就整条拒收", () => {
    expect(parseParams("getCommitDetails", { repo: "/r", hashes: [hash] })).toEqual({
      repo: "/r",
      hashes: [hash],
    });
    expect(parseParams("getCommitDetails", { repo: "/r", hashes: [] })).toEqual({
      repo: "/r",
      hashes: [],
    });
    expect(
      parseParams("getCommitDetails", { repo: "/r", hashes: [hash, "--all"] }),
    ).toBeUndefined();
  });
});

describe("进命令行的短名：空串和 - 开头拒收", () => {
  it("checkout、renameBranch", () => {
    expect(parseParams("checkout", { repo: "/r", branch: "feat/x" })).toEqual({
      repo: "/r",
      branch: "feat/x",
    });
    expect(parseParams("checkout", { repo: "/r", branch: "--detach" })).toBeUndefined();
    expect(parseParams("renameBranch", { repo: "/r", branch: "" })).toBeUndefined();
  });

  it("newBranch 的 start 与 rebase 一样：完整引用或完整 hash", () => {
    const ok = { repo: "/r", start: "refs/heads/main", startName: "main" };
    expect(parseParams("newBranch", ok)).toEqual(ok);
    expect(parseParams("newBranch", { repo: "/r", start: HASH, startName: "x" })).toEqual({
      repo: "/r",
      start: HASH,
      startName: "x",
    });
    expect(
      parseParams("newBranch", { repo: "/r", start: "main", startName: "main" }),
    ).toBeUndefined();
    expect(
      parseParams("newBranch", { repo: "/r", start: "--detach", startName: "x" }),
    ).toBeUndefined();
  });
});
