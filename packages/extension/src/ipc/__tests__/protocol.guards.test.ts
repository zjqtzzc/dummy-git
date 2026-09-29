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
