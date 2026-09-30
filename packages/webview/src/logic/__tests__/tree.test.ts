import { describe, expect, it } from "vitest";
import {
  branchIds,
  flattenTree,
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
