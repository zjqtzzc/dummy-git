import type { CommitSkeleton } from "@dummy-git/shared";
import { describe, expect, it } from "vitest";
import { buildStructure } from "../structure.js";

/** 按行写骨架：`["c", "b"]` 表示提交 c 的父提交是 b。时间与图无关，统一给 0。 */
function skeleton(rows: readonly (readonly string[])[]): CommitSkeleton[] {
  return rows.map(([hash = "", ...parents]) => ({ hash, parents, at: 0 }));
}

describe("buildStructure：骨架换成按行号的图", () => {
  it("一条直线：每行的父提交是下一行", () => {
    const { parents } = buildStructure(skeleton([["c", "b"], ["b", "a"], ["a"]]));
    expect(parents).toEqual([[1], [2], []]);
  });

  it("合并提交：父行号保持第一父提交在前", () => {
    const { parents } = buildStructure(
      skeleton([["m", "a", "f"], ["f", "base"], ["a", "base"], ["base"]]),
    );
    expect(parents[0]).toEqual([2, 1]);
  });

  it("不在骨架里的父提交（截断处）不列，只计数", () => {
    const { parents, missingParents } = buildStructure(
      skeleton([["m", "outside", "a"], ["a", "gone"], ["root"]]),
    );
    expect(parents).toEqual([[1], [], []]);
    expect(missingParents).toEqual([1, 1, 0]);
  });
});
