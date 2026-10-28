import { type CommitFileChange, MenuContextKey, type Stash } from "@dummy-git/shared";
import { commitFileEntry } from "../log/commitDiff.js";
import {
  exactlyOne,
  type MenuArgs,
  type MenuItem,
  MenuView,
  type MenuViews,
  menuItem,
  menuItemsContext,
} from "../menuItems.js";
import { buildFileTree, toTreeNodes as fileTreeNodes, scopedId } from "../tree/fileTree.js";
import type { TreeNode } from "../tree/tree.js";
import { formatTime } from "../utils/time.js";

/** 一条 stash 和它改了的文件。 */
export interface StashFiles {
  readonly stash: Stash;
  /** 已跟踪的：stash 对存时所在提交的改动。 */
  readonly tracked: readonly CommitFileChange[];
  /** 未跟踪的：附属提交里的文件，都是新增。 */
  readonly untracked: readonly CommitFileChange[];
}

/** 打开一个文件的 diff 要的东西：哪条提交、它的父提交、文件。 */
export interface StashFile {
  readonly hash: string;
  readonly parents: readonly string[];
  readonly file: CommitFileChange;
}

/**
 * stash 的右键菜单项。选中的是 stash 那一行时是它的 hash，是它下面的文件、目录时是 `null`。
 * 都只能对一条做；多选后能做什么还没定。
 */
const STASH_MENU: readonly MenuItem<string | null>[] = [
  MenuContextKey.PopStash,
  MenuContextKey.ApplyStash,
  MenuContextKey.RenameStash,
  MenuContextKey.DropStash,
].map((key) =>
  menuItem({
    view: MenuView.Exact,
    key,
    pick: (hash: string | null) => hash ?? undefined,
    whole: exactlyOne,
    value: ([hash]) => ({ hash }),
  }),
);

/** 选中（两种看法）→ 右键菜单上下文：仓库，加上能做的各菜单项的键。 */
export function stashMenuContext(
  views: MenuViews<string | null>,
  repo: string,
): Readonly<Record<string, string | MenuArgs>> {
  return { [MenuContextKey.Repo]: repo, ...menuItemsContext(views, STASH_MENU) };
}

/**
 * Stash 模式的树：每条 stash 一个顶层节点，
 * 标题是 git 生成的说明、后面灰字时间；下面是它改了的文件（已跟踪与未跟踪合在一起），`byDirectory` 时按目录整理，否则平铺。
 *
 * 每条 stash 是文件树的一组，组的 id 是 hash：文件与目录的 id 是 `<hash>/<路径>`（`scopedId`），
 * 同一个文件出现在好几条 stash 里也不撞。顶层节点的 id 就是 hash。
 * 顶层节点带右键菜单上下文（Pop、Apply ｜ Rename… ｜ Delete），和 `package.json` 菜单项的 `when` 条件对应。
 */
export function stashTreeNodes(
  list: readonly StashFiles[],
  light: boolean,
  now: number,
  byDirectory: boolean,
): TreeNode[] {
  return list.map(({ stash, tracked, untracked }) => {
    const entries = [...tracked, ...untracked].map(commitFileEntry);
    const files = fileTreeNodes(buildFileTree([{ id: stash.hash, entries }], byDirectory), light);
    return {
      id: stash.hash,
      label: stash.message,
      description: formatTime(stash.at, now),
      children: files,
    };
  });
}

/** 文件节点 id → 打开 diff 要的东西。已跟踪的对存时所在的提交；未跟踪的对空（附属提交没有父提交）。 */
export function stashFilesById(list: readonly StashFiles[]): ReadonlyMap<string, StashFile> {
  const index = new Map<string, StashFile>();
  for (const { stash, tracked, untracked } of list) {
    for (const file of tracked) {
      index.set(scopedId(stash.hash, file.path), { hash: stash.hash, parents: [stash.base], file });
    }
    if (stash.untracked === undefined) continue;
    for (const file of untracked) {
      index.set(scopedId(stash.hash, file.path), { hash: stash.untracked, parents: [], file });
    }
  }
  return index;
}

/** 节点 id → 它属于哪条 stash（hash）。选中 stash 那一行或它下面的任何一行，都算选中了这条 stash。 */
export function stashByNodeId(nodes: readonly TreeNode[]): ReadonlyMap<string, string> {
  const index = new Map<string, string>();
  const visit = (node: TreeNode, hash: string): void => {
    index.set(node.id, hash);
    for (const child of node.children ?? []) visit(child, hash);
  };
  for (const node of nodes) visit(node, node.id);
  return index;
}
