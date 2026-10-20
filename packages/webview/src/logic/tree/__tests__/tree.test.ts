import { describe, expect, it } from "vitest";
import {
  branchIds,
  CheckState,
  checkState,
  flattenTree,
  leafIds,
  selectionViews,
  setExpanded,
  TreeKeyActionKind,
  type TreeNode,
  type TreeRow,
  treeKeyAction,
} from "../tree.js";

const leaf = (id: string): TreeNode => ({ id, label: id });
const branch = (id: string, children: readonly TreeNode[]): TreeNode => ({
  id,
  label: id,
  children,
});

/**
 * a/
 *   b/
 *     x
 *   y
 * z
 */
const TREE = [branch("a", [branch("b", [leaf("x")]), leaf("y")]), leaf("z")];

/** 行 → 缩进文本，展开的写 `v`，收起的写 `>`。 */
function outline(rows: readonly TreeRow[]): string[] {
  return rows.map((row) => {
    const mark = row.expanded === undefined ? " " : row.expanded ? "v" : ">";
    return `${"  ".repeat(row.depth)}${mark} ${row.node.id}`;
  });
}

describe("flattenTree", () => {
  it("只列出看得见的行，收起的节点下面不列", () => {
    expect(outline(flattenTree(TREE, new Set(["a"])))).toEqual(["v a", "  > b", "    y", "  z"]);
  });

  it("全部展开", () => {
    expect(outline(flattenTree(TREE, new Set(branchIds(TREE))))).toEqual([
      "v a",
      "  v b",
      "      x",
      "    y",
      "  z",
    ]);
  });

  it("每行记着父节点，顶层没有", () => {
    const rows = flattenTree(TREE, new Set(branchIds(TREE)));
    expect(rows.map((row) => row.parent)).toEqual([undefined, "a", "b", "a", undefined]);
  });
});

describe("setExpanded", () => {
  it("收起时下面的节点一起收起，再展开只露出一层", () => {
    const all = new Set(branchIds(TREE));
    const [a] = TREE;
    if (a === undefined) throw new Error("没有 a");
    const collapsed = setExpanded(all, a, false);
    expect([...collapsed]).toEqual([]);
    expect(outline(flattenTree(TREE, setExpanded(collapsed, a, true)))).toEqual([
      "v a",
      "  > b",
      "    y",
      "  z",
    ]);
  });
});

describe("treeKeyAction：照 VS Code 原生的树", () => {
  const rows = flattenTree(TREE, new Set(branchIds(TREE)));
  // 0:a  1:b  2:x  3:y  4:z

  it("上下移动，到头不动；还没选中时下键选第一行", () => {
    expect(treeKeyAction(rows, 0, "ArrowDown")).toEqual({
      kind: TreeKeyActionKind.Select,
      index: 1,
    });
    expect(treeKeyAction(rows, 4, "ArrowDown")).toEqual({
      kind: TreeKeyActionKind.Select,
      index: 4,
    });
    expect(treeKeyAction(rows, 0, "ArrowUp")).toEqual({ kind: TreeKeyActionKind.Select, index: 0 });
    expect(treeKeyAction(rows, -1, "ArrowDown")).toEqual({
      kind: TreeKeyActionKind.Select,
      index: 0,
    });
  });

  it("左：展开着就收起，否则跳到父节点", () => {
    expect(treeKeyAction(rows, 1, "ArrowLeft")).toEqual({
      kind: TreeKeyActionKind.Expand,
      open: false,
    });
    expect(treeKeyAction(rows, 2, "ArrowLeft")).toEqual({
      kind: TreeKeyActionKind.Select,
      index: 1,
    });
    expect(treeKeyAction(rows, 4, "ArrowLeft")).toBeUndefined();
  });

  it("右：收起着就展开，展开着就跳到第一个子节点，叶子不动", () => {
    const folded = flattenTree(TREE, new Set(["a"]));
    expect(treeKeyAction(folded, 1, "ArrowRight")).toEqual({
      kind: TreeKeyActionKind.Expand,
      open: true,
    });
    expect(treeKeyAction(rows, 0, "ArrowRight")).toEqual({
      kind: TreeKeyActionKind.Select,
      index: 1,
    });
    expect(treeKeyAction(rows, 2, "ArrowRight")).toBeUndefined();
  });

  it("回车：叶子打开，可展开的节点切换", () => {
    expect(treeKeyAction(rows, 2, "Enter")).toEqual({ kind: TreeKeyActionKind.Activate });
    expect(treeKeyAction(rows, 1, "Enter")).toEqual({
      kind: TreeKeyActionKind.Expand,
      open: false,
    });
  });
});

describe("复选框", () => {
  const [a, z] = TREE;

  it("上级：下面的叶子全勾是勾，一部分是半选，都没勾是不勾", () => {
    if (a === undefined) throw new Error("没有 a");
    expect(checkState(a, new Set(["x", "y"]))).toBe(CheckState.Checked);
    expect(checkState(a, new Set(["x"]))).toBe(CheckState.Mixed);
    expect(checkState(a, new Set(["z"]))).toBe(CheckState.Unchecked);
  });

  it("叶子只有勾与不勾", () => {
    if (z === undefined) throw new Error("没有 z");
    expect(checkState(z, new Set(["z"]))).toBe(CheckState.Checked);
    expect(checkState(z, new Set())).toBe(CheckState.Unchecked);
  });

  it("勾一个上级，就是勾它下面所有叶子", () => {
    if (a === undefined) throw new Error("没有 a");
    expect(leafIds(a)).toEqual(["x", "y"]);
  });
});

describe("selectionViews：选中的两种看法", () => {
  const ids = (nodes: readonly TreeNode[]) => nodes.map((node) => node.id);
  const all = new Set(["a", "b"]);

  it("原样看是看得见的选中行；展开看把目录换成下面的全部叶子（收起着的也算）", () => {
    const rows = flattenTree(TREE, new Set(["a"]));
    const views = selectionViews(rows, new Set(["b", "z"]));
    expect(ids(views.exact)).toEqual(["b", "z"]);
    expect(ids(views.expanded)).toEqual(["x", "z"]);
  });

  it("目录和它下面的一起选：叶子只算一次", () => {
    const rows = flattenTree(TREE, all);
    expect(ids(selectionViews(rows, new Set(["a", "x", "y"])).expanded)).toEqual(["x", "y"]);
  });

  it("收起的目录里原来选中的不算", () => {
    const rows = flattenTree(TREE, new Set());
    const views = selectionViews(rows, new Set(["x", "z"]));
    expect(ids(views.exact)).toEqual(["z"]);
    expect(ids(views.expanded)).toEqual(["z"]);
  });
});
