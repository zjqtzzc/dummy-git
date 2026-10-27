import { type Ref, RefKind } from "@dummy-git/shared";
import { describe, expect, it } from "vitest";
import { buildLayout } from "../layout.js";
import { buildStructure } from "../structure.js";
import { skeleton } from "./skeleton.js";

const local = (name: string, target: string): Ref => ({ kind: RefKind.LocalBranch, name, target });
const remote = (r: string, name: string, target: string): Ref => ({
  kind: RefKind.RemoteBranch,
  remote: r,
  name,
  target,
});
const head = (target: string, branch?: string): Ref => ({
  kind: RefKind.Head,
  target,
  ...(branch === undefined ? {} : { branch }),
});

function layout(rows: readonly (readonly string[])[], refs: readonly Ref[]) {
  return buildLayout(buildStructure(skeleton(rows)), refs);
}

describe("buildLayout：沿第一父提交编号", () => {
  it("一条直线共用一个编号", () => {
    const { indexes } = layout([["c", "b"], ["b", "a"], ["a"]], [local("main", "c")]);
    expect(indexes).toEqual([1, 1, 1]);
  });

  it("分叉：先编号的头占住共同祖先，另一条只到分叉点为止", () => {
    const { indexes } = layout(
      [["f2", "f1"], ["m2", "m1"], ["f1", "m1"], ["m1", "m0"], ["m0"]],
      [local("main", "m2"), local("feature", "f2"), head("m2", "main")],
    );
    expect(indexes).toEqual([2, 1, 2, 1, 1]);
  });

  it("合并：第二个父提交开新的编号", () => {
    const { indexes } = layout(
      [["merge", "a", "f"], ["f", "base"], ["a", "base"], ["base"]],
      [local("main", "merge")],
    );
    expect(indexes).toEqual([1, 2, 1, 1]);
  });

  it("三个父提交的合并：其余父提交按顺序各开一个编号", () => {
    const { indexes } = layout(
      [["merge", "a", "x", "y"], ["y", "base"], ["x", "base"], ["a", "base"], ["base"]],
      [local("main", "merge")],
    );
    expect(indexes).toEqual([1, 3, 2, 1, 1]);
  });
});

describe("buildLayout：头的先后", () => {
  /** 两个头各一个提交，共同的父提交 base：编号 1 的那个头车道在左。 */
  const twoHeads = (first: Ref, second: Ref) =>
    layout([["x", "base"], ["y", "base"], ["base"]], [first, second]).indexes;

  it("远程排在本地前面", () => {
    expect(twoHeads(local("main", "x"), remote("origin", "main", "y"))).toEqual([2, 1, 1]);
  });

  it("当前分支排最左，与名字无关", () => {
    expect(
      layout(
        [["x", "base"], ["y", "base"], ["base"]],
        [local("aaa", "x"), local("zzz", "y"), head("y", "zzz")],
      ).indexes,
    ).toEqual([2, 1, 1]);
  });

  it("同类按名字", () => {
    expect(twoHeads(local("b", "x"), local("a", "y"))).toEqual([2, 1, 1]);
  });

  it("detached HEAD 排在 tag 前面", () => {
    const tag: Ref = { kind: RefKind.Tag, name: "v1", target: "y", annotated: false };
    expect(twoHeads(head("x"), tag)).toEqual([1, 2, 1]);
  });

  it("没有 ref 的头排在有 ref 的后面", () => {
    expect(layout([["x", "base"], ["y", "base"], ["base"]], [local("main", "y")]).indexes).toEqual([
      2, 1, 1,
    ]);
  });

  it("同一提交上有多个 ref：按排第一的那个", () => {
    const refs = [local("zzz", "x"), local("aaa", "x"), local("feature", "y"), head("y", "feature")];
    expect(layout([["x", "base"], ["y", "base"], ["base"]], refs).indexes).toEqual([2, 1, 1]);
  });
});

describe("buildLayout：mainRefs", () => {
  it("主链的编号对应头上排第一的 ref，分叉出来的片段不在表里", () => {
    const main = local("main", "merge");
    const { mainRefs } = layout(
      [["merge", "a", "f"], ["f", "base"], ["a", "base"], ["base"]],
      [main],
    );
    expect(mainRefs.get(1)).toEqual(main);
    expect(mainRefs.has(2)).toBe(false);
  });

  it("没有 ref 的头也是主链，对应 undefined", () => {
    const { mainRefs } = layout([["x", "base"], ["base"]], []);
    expect(mainRefs.has(1)).toBe(true);
    expect(mainRefs.get(1)).toBeUndefined();
  });
});
