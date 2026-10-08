import {
  type CommitFileChange,
  MenuContextKey,
  MenuNodeValue,
  type Stash,
} from "@dummy-git/shared";
import { commitFileEntry } from "../log/commitDiff.js";
import { buildFileTree, toTreeNodes as fileTreeNodes } from "../tree/fileTree.js";
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
 * Stash 模式的树（`.notes/design/phase-4.md` 第 8 条）：每条 stash 一个顶层节点，
 * 标题是 git 生成的说明、后面灰字时间；下面是它改了的文件（已跟踪与未跟踪合在一起），按目录整理。
 *
 * 同一个文件可以出现在好几条 stash 里，而节点 id 在一棵树里必须唯一，
 * 所以文件与目录的 id 前面加上 stash 的 hash（`<hash>/<路径>`）。顶层节点的 id 就是 hash。
 * 顶层节点带右键菜单上下文（Pop、Apply ｜ Delete），和 `package.json` 菜单项的 `when` 条件对应。
 */
export function stashTreeNodes(
  list: readonly StashFiles[],
  repo: string,
  light: boolean,
  now: number,
): TreeNode[] {
  return list.map(({ stash, tracked, untracked }) => {
    const entries = [...tracked, ...untracked].map(commitFileEntry);
    const files = fileTreeNodes(buildFileTree([{ id: stash.hash, entries }]), light);
    return {
      id: stash.hash,
      label: stash.message,
      description: formatTime(stash.at, now),
      menu: {
        [MenuContextKey.Node]: MenuNodeValue.Stash,
        [MenuContextKey.Repo]: repo,
        [MenuContextKey.Stash]: stash.hash,
      },
      children: scoped(stash.hash, files),
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

function scopedId(hash: string, id: string): string {
  return `${hash}/${id}`;
}

function scoped(hash: string, nodes: readonly TreeNode[]): TreeNode[] {
  return nodes.map((node) =>
    node.children === undefined
      ? { ...node, id: scopedId(hash, node.id) }
      : { ...node, id: scopedId(hash, node.id), children: scoped(hash, node.children) },
  );
}
