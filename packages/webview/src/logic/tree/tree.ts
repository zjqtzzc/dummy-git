import type { IconRef } from "../icons.js";
import type { MenuViews } from "../menuItems.js";

/**
 * 所有树共用的纯逻辑：节点的统一形状、按展开状态压平成行、
 * 展开 / 收起、键盘。外观与交互照 VS Code 原生的树。
 */

/** 树的一个节点。各使用方把自己的数据转成它；「类型 → 图标 / 颜色 / 字母」表各自持有。 */
export interface TreeNode {
  /** 在这棵树里唯一。展开状态、选中都按它记。 */
  readonly id: string;
  readonly label: string;
  readonly bold?: boolean;
  /** 行首的图标；缺席即没有图标（比如组标题）。 */
  readonly icon?: IconRef;
  /** 展开时换成它，比如打开的文件夹；缺席则不换。 */
  readonly openedIcon?: IconRef;
  /** 图标的颜色（比如当前分支的黄色标签）；缺席则跟着行的颜色。Seti 图标自带颜色。 */
  readonly iconColor?: string;
  /** 文字与右侧字母的颜色，CSS 颜色值。 */
  readonly color?: string;
  /** 文字后面的灰字，比如 `3 files`、`renamed from a.ts`。 */
  readonly description?: string;
  /** 行尾的字母，比如 `M`。 */
  readonly decoration?: string;
  /** 有就是可展开的（哪怕是空数组）。 */
  /** 给了勾选集合的树里，这个节点也不画复选框（Commit 面板的冲突组：冲突文件不能勾去提交）。 */
  readonly uncheckable?: boolean;
  /** 使用方插槽靠右。 */
  readonly alignEnd?: boolean;
  readonly children?: readonly TreeNode[];
}

/** 压平之后的一行。 */
export interface TreeRow {
  readonly node: TreeNode;
  /** 顶层是 0。 */
  readonly depth: number;
  /** 父节点的 id；顶层缺席。 */
  readonly parent?: string;
  /** 可展开的节点才有：是否展开。叶子缺席。 */
  readonly expanded?: boolean;
}

/** 按展开状态压平：只列出看得见的行，顺序即显示顺序。 */
export function flattenTree(nodes: readonly TreeNode[], expanded: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  const visit = (node: TreeNode, depth: number, parent: string | undefined): void => {
    const base = parent === undefined ? { node, depth } : { node, depth, parent };
    if (node.children === undefined) {
      rows.push(base);
      return;
    }
    const open = expanded.has(node.id);
    rows.push({ ...base, expanded: open });
    if (open) for (const child of node.children) visit(child, depth + 1, node.id);
  };
  for (const node of nodes) visit(node, 0, undefined);
  return rows;
}

/**
 * 选中的两种看法（右键菜单用，见 `logic/menuItems.ts` 的 `MenuView`），都按显示顺序：
 * 原样看是看得见的选中行；展开看是其中的叶子，加上选中目录下面的全部叶子（收起着的也算），去掉重复。
 * 只看看得见的行：收起的目录里原来选中的不算，展开后又算（id 一直留在选中里）。
 */
export function selectionViews(
  rows: readonly TreeRow[],
  ids: ReadonlySet<string>,
): MenuViews<TreeNode> {
  const exact = rows.filter((row) => ids.has(row.node.id)).map((row) => row.node);
  const seen = new Set<string>();
  const expanded: TreeNode[] = [];
  const collect = (node: TreeNode): void => {
    if (node.children === undefined) {
      if (!seen.has(node.id)) expanded.push(node);
      seen.add(node.id);
      return;
    }
    for (const child of node.children) collect(child);
  };
  for (const node of exact) collect(node);
  return { exact, expanded };
}

/** 所有可展开节点的 id。全部展开就是它。 */
export function branchIds(nodes: readonly TreeNode[]): string[] {
  return nodes.flatMap((node) =>
    node.children === undefined ? [] : [node.id, ...branchIds(node.children)],
  );
}

/**
 * 展开或收起一个节点，返回新的展开集合。
 * 收起时它下面的节点一起收起，再展开只露出一层。
 */
export function setExpanded(
  expanded: ReadonlySet<string>,
  node: TreeNode,
  open: boolean,
): ReadonlySet<string> {
  const next = new Set(expanded);
  if (open) {
    next.add(node.id);
    return next;
  }
  next.delete(node.id);
  for (const id of branchIds(node.children ?? [])) next.delete(id);
  return next;
}

export enum TreeKeyActionKind {
  /** 选中第 `index` 行。 */
  Select = "select",
  /** 展开或收起这一行的节点。 */
  Expand = "expand",
  /** 打开（回车落在叶子上）。 */
  Activate = "activate",
}

export type TreeKeyAction =
  | { readonly kind: TreeKeyActionKind.Select; readonly index: number }
  | { readonly kind: TreeKeyActionKind.Expand; readonly open: boolean }
  | { readonly kind: TreeKeyActionKind.Activate };

/**
 * 按键在第 `index` 行上该做什么，照 VS Code 原生的树：
 * - 上 / 下：上一行 / 下一行（`index` 为 -1 表示还没有选中，下键选第一行）。
 * - 左：展开着就收起，否则跳到父节点。
 * - 右：收起着就展开，展开着就跳到第一个子节点。
 * - 回车：叶子打开，可展开的节点展开 / 收起。
 * 返回 `undefined` 表示不处理这个键。
 */
export function treeKeyAction(
  rows: readonly TreeRow[],
  index: number,
  key: string,
): TreeKeyAction | undefined {
  const last = rows.length - 1;
  if (key === "ArrowDown") {
    return last < 0
      ? undefined
      : { kind: TreeKeyActionKind.Select, index: Math.min(last, index + 1) };
  }
  if (key === "ArrowUp") {
    return last < 0 ? undefined : { kind: TreeKeyActionKind.Select, index: Math.max(0, index - 1) };
  }
  const row = rows[index];
  if (row === undefined) return undefined;
  switch (key) {
    case "ArrowLeft": {
      if (row.expanded === true) return { kind: TreeKeyActionKind.Expand, open: false };
      const parent = rows.findIndex((r) => r.node.id === row.parent);
      return parent === -1 ? undefined : { kind: TreeKeyActionKind.Select, index: parent };
    }
    case "ArrowRight":
      if (row.expanded === false) return { kind: TreeKeyActionKind.Expand, open: true };
      if (row.expanded === true && rows[index + 1]?.parent === row.node.id) {
        return { kind: TreeKeyActionKind.Select, index: index + 1 };
      }
      return undefined;
    case "Enter":
      return row.expanded === undefined
        ? { kind: TreeKeyActionKind.Activate }
        : { kind: TreeKeyActionKind.Expand, open: !row.expanded };
    default:
      return undefined;
  }
}

/** 复选框的三种样子。可展开的节点由下面的叶子推出来。 */
export enum CheckState {
  Checked = "checked",
  Unchecked = "unchecked",
  Mixed = "mixed",
}

/** 节点下面（含自己）所有叶子的 id。勾一个上级节点，就是勾这些。 */
export function leafIds(node: TreeNode): string[] {
  return node.children === undefined ? [node.id] : node.children.flatMap(leafIds);
}

/** 由勾选的叶子集合推出一个节点的复选框：全勾、全不勾，或者半选。没有叶子的上级算不勾。 */
export function checkState(node: TreeNode, checked: ReadonlySet<string>): CheckState {
  const ids = leafIds(node);
  const count = ids.filter((id) => checked.has(id)).length;
  if (count === 0) return CheckState.Unchecked;
  return count === ids.length ? CheckState.Checked : CheckState.Mixed;
}
