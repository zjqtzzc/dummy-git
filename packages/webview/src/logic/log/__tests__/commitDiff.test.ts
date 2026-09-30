import { DiffSideKind, FileStatus } from "@dummy-git/shared";
import { describe, expect, it } from "vitest";
import { commitDiffSides } from "../commitDiff.js";

const C = "c".repeat(40);
const P = "p".repeat(40);

describe("commitDiffSides：提交详情里点开一个文件，左右各是什么", () => {
  it("修改：父提交 ↔ 这条提交", () => {
    expect(commitDiffSides(C, [P], { path: "a.ts", status: FileStatus.Modified })).toEqual({
      left: { kind: DiffSideKind.Revision, hash: P, path: "a.ts" },
      right: { kind: DiffSideKind.Revision, hash: C, path: "a.ts" },
    });
  });

  it("新增：左边不存在", () => {
    expect(commitDiffSides(C, [P], { path: "a.ts", status: FileStatus.Added }).left).toEqual({
      kind: DiffSideKind.Missing,
      path: "a.ts",
    });
  });

  it("删除：右边不存在", () => {
    expect(commitDiffSides(C, [P], { path: "a.ts", status: FileStatus.Deleted }).right).toEqual({
      kind: DiffSideKind.Missing,
      path: "a.ts",
    });
  });

  it("改名：左边用父提交里的旧路径", () => {
    const sides = commitDiffSides(C, [P], {
      path: "new.ts",
      oldPath: "old.ts",
      status: FileStatus.Renamed,
    });
    expect(sides.left).toEqual({ kind: DiffSideKind.Revision, hash: P, path: "old.ts" });
    expect(sides.right).toEqual({ kind: DiffSideKind.Revision, hash: C, path: "new.ts" });
  });

  it("根提交没有父提交：左边不存在", () => {
    expect(commitDiffSides(C, [], { path: "a.ts", status: FileStatus.Modified }).left).toEqual({
      kind: DiffSideKind.Missing,
      path: "a.ts",
    });
  });
});
