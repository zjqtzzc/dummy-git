import { DiffOpenMode, DiffSideKind } from "@dummy-git/shared";
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
});

describe("amend 的参数校验", () => {
  it("路径可以为空：只改说明", () => {
    const raw = { repo: "/r", message: "msg", paths: [] };
    expect(parseParams("amend", raw)).toEqual(raw);
  });
});

describe("getSkeleton 的 branch", () => {
  it("缺席或完整引用名都收；不是 refs/ 开头的拒收（会进 git 的命令行，`-` 开头会被当成选项）", () => {
    expect(parseParams("getSkeleton", { repo: "/r" })).toEqual({ repo: "/r" });
    expect(parseParams("getSkeleton", { repo: "/r", branch: "refs/heads/main" })).toEqual({
      repo: "/r",
      branch: "refs/heads/main",
    });
    expect(parseParams("getSkeleton", { repo: "/r", branch: "--all" })).toBeUndefined();
    expect(parseParams("getSkeleton", { repo: "/r", branch: "main" })).toBeUndefined();
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
  });
});
