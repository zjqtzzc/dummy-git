import { type Ref, RefKind } from "@dummy-git/shared";
import { describe, expect, it } from "vitest";
import { buildColors } from "../color.js";
import { buildLayout } from "../layout.js";
import { buildStructure } from "../structure.js";
import { skeleton } from "./skeleton.js";

const local = (name: string, target: string): Ref => ({ kind: RefKind.LocalBranch, name, target });

function colors(rows: readonly (readonly string[])[], refs: readonly Ref[]) {
  return buildColors(buildLayout(buildStructure(skeleton(rows)), refs));
}

describe("buildColors", () => {
  it("同一个分支名同一个颜色，与它排第几、编号是几无关", () => {
    const alone = colors([["f", "b"], ["b"]], [local("feature", "f")]);
    const second = colors(
      [["m", "b"], ["f", "b"], ["b"]],
      [local("main", "m"), local("feature", "f")],
    );
    expect(second.at(1)).toBe(alone.at(0));
    expect(second.at(0)).not.toBe(second.at(1));
  });

  it("主链上的提交都是分支的颜色", () => {
    const [c, b, a] = colors([["c", "b"], ["b", "a"], ["a"]], [local("main", "c")]);
    expect(b).toBe(c);
    expect(a).toBe(c);
  });

  it("没有 ref 的片段取编号", () => {
    // 合并进来的 f 是片段：main 编号 1，f 编号 2。
    const result = colors(
      [["merge", "a", "f"], ["f", "base"], ["a", "base"], ["base"]],
      [local("main", "merge")],
    );
    expect(result.at(1)).toBe(2);
  });

  it("没有 ref 的头，它的主链用默认色；合并进来的片段仍取编号", () => {
    const result = colors([["merge", "a", "f"], ["f", "base"], ["a", "base"], ["base"]], []);
    expect(result).toEqual([undefined, 2, undefined, undefined]);
  });

  it("颜色 id 非负", () => {
    const names = [
      "main",
      "feature/very-long-branch-name-to-overflow-the-hash",
      "x",
      "release/2026",
    ];
    const result = colors(
      names.map((name) => [name]),
      names.map((name) => local(name, name)),
    );
    for (const color of result) expect(color ?? -1).toBeGreaterThanOrEqual(0);
  });
});
