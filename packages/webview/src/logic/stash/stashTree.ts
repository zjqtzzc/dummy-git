import {
  assertNever,
  type CommitFileChange,
  FileStatus,
  MenuContextKey,
  type Stash,
} from "@dummy-git/shared";
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

enum StashMenuKind {
  Stash = "stash",
  Tracked = "tracked",
  Untracked = "untracked",
}

/** 一行的右键菜单要用的：stash 那一行，或它下面的一个文件（`hash` 是它属于的那条 stash）。目录是 `null`。 */
export type StashMenuTarget =
  | { readonly kind: StashMenuKind.Stash; readonly hash: string }
  /** `paths`：改名时两头都在，旧路径在 stash 里没有，取回时删掉。 */
  | {
      readonly kind: StashMenuKind.Tracked;
      readonly hash: string;
      readonly paths: readonly string[];
    }
  | { readonly kind: StashMenuKind.Untracked; readonly hash: string; readonly path: string };

type StashFileTarget = Exclude<StashMenuTarget, { readonly kind: StashMenuKind.Stash }>;

function stashHash(target: StashMenuTarget | null): string | undefined {
  return target?.kind === StashMenuKind.Stash ? target.hash : undefined;
}

function fileTarget(target: StashMenuTarget | null): StashFileTarget | undefined {
  if (target === null) return undefined;
  switch (target.kind) {
    case StashMenuKind.Stash:
      return undefined;
    case StashMenuKind.Tracked:
    case StashMenuKind.Untracked:
      return target;
    default:
      return assertNever(target, "fileTarget");
  }
}

/** 选中的文件 → 协议的两份路径：已跟踪的（改名两头都在）、未跟踪的。 */
function filePaths(files: readonly StashFileTarget[]): {
  paths: readonly string[];
  untracked: readonly string[];
} {
  const paths: string[] = [];
  const untracked: string[] = [];
  for (const file of files) {
    switch (file.kind) {
      case StashMenuKind.Tracked:
        paths.push(...file.paths);
        break;
      case StashMenuKind.Untracked:
        untracked.push(file.path);
        break;
      default:
        assertNever(file, "filePaths");
    }
  }
  return { paths, untracked };
}

/**
 * stash 的右键菜单项。stash 那一行的几项只能对一条做。
 * Apply Selected Files 展开看、全部严格：目录等于它下面的全部文件，都要属于同一条 stash；
 * 选中里含 stash 那一行时没有这一项，整条用那一行的 Apply。
 */
const STASH_MENU: readonly MenuItem<StashMenuTarget | null>[] = [
  ...[
    MenuContextKey.PopStash,
    MenuContextKey.ApplyStash,
    MenuContextKey.RenameStash,
    MenuContextKey.DropStash,
  ].map((key) =>
    menuItem({
      view: MenuView.Exact,
      key,
      pick: stashHash,
      whole: exactlyOne,
      value: ([hash]) => ({ hash }),
    }),
  ),
  menuItem({
    view: MenuView.Expanded,
    key: MenuContextKey.ApplyStashFiles,
    pick: fileTarget,
    whole: ([first, ...rest], views) =>
      views.exact.every((target) => stashHash(target) === undefined) &&
      rest.every((file) => file.hash === first.hash),
    value: (files) => ({ hash: files[0].hash, ...filePaths(files) }),
  }),
];

/** 选中（两种看法）→ 右键菜单上下文：仓库，加上能做的各菜单项的键。 */
export function stashMenuContext(
  views: MenuViews<StashMenuTarget | null>,
  repo: string,
): Readonly<Record<string, string | MenuArgs>> {
  return { [MenuContextKey.Repo]: repo, ...menuItemsContext(views, STASH_MENU) };
}

/** 节点 id → 它的右键菜单要用的：stash 那一行与每个文件。目录不在里面（`null`）。 */
export function stashMenuTargets(
  list: readonly StashFiles[],
): ReadonlyMap<string, StashMenuTarget> {
  const index = new Map<string, StashMenuTarget>();
  for (const { stash, tracked, untracked } of list) {
    const { hash } = stash;
    index.set(hash, { kind: StashMenuKind.Stash, hash });
    for (const file of tracked) {
      // 只有改名带上旧路径；复制的源文件还在，不碰。
      const paths =
        file.status === FileStatus.Renamed && file.oldPath !== undefined
          ? [file.oldPath, file.path]
          : [file.path];
      index.set(scopedId(hash, file.path), { kind: StashMenuKind.Tracked, hash, paths });
    }
    for (const file of untracked) {
      index.set(scopedId(hash, file.path), {
        kind: StashMenuKind.Untracked,
        hash,
        path: file.path,
      });
    }
  }
  return index;
}

/**
 * Stash 模式的树：每条 stash 一个顶层节点，
 * 标题是 git 生成的说明、后面灰字时间；下面是它改了的文件（已跟踪与未跟踪合在一起），`byDirectory` 时按目录整理，否则平铺。
 *
 * 每条 stash 是文件树的一组，组的 id 是 hash：文件与目录的 id 是 `<hash>/<路径>`（`scopedId`），
 * 同一个文件出现在好几条 stash 里也不撞。顶层节点的 id 就是 hash。
 * 右键菜单按选中算（`stashMenuContext`，每一行要用的东西见 `stashMenuTargets`）。
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
