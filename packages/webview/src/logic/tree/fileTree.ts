import { assertNever } from "@dummy-git/shared";
import { codicon, IconKind } from "../icons.js";
import { setiIcon } from "./setiIcon.js";
import type { TreeNode } from "./tree.js";

/**
 * 所有文件树共用的整理逻辑：几组文件整理成树。
 *
 * - 有标题的组画成顶层一行（`Changes  N files`），下面是它自己的目录树；空组不画，除非 `keepEmpty`。
 * - 只有一个子目录、自己没有文件的目录链合并成一行（`apps/rgv_calib_parser`）。
 * - 目录带「下面一共几个文件」。
 * - 目录在前、文件在后，各按名字排序。
 */

/**
 * 文件树里的一个文件。各使用方把自己的数据转成它，并各自持有「改动类型 → 字母 / 颜色」表；
 * 树只认它。
 */
export interface FileEntry {
  /** 相对仓库根、`/` 分隔。 */
  readonly path: string;
  /** 改名 / 复制前的路径；其余缺席。 */
  readonly oldPath?: string;
  /** 右侧的改动字母，比如 `M`。 */
  readonly letter: string;
  /** 文件名与字母的颜色，CSS 颜色值。 */
  readonly color: string;
  /** 文件名后面的灰字（冲突类型）。改名的写「renamed from …」，两者不会同时有。 */
  readonly description?: string;
}

/**
 * 一组文件。有标题时画成顶层一行；没有标题时直接铺开（Log 右栏只有这一组）。
 */
export interface FileGroup {
  /** 组的身份，在同一棵树里唯一。 */
  readonly id: string;
  readonly label?: string;
  readonly entries: readonly FileEntry[];
  /** 整组不画复选框，勾选也不保留这组的路径（冲突组）。只对有标题的组有效。 */
  readonly uncheckable?: boolean;
  /**
   * 标题后的灰字，替代默认的文件数。空字符串表示不写灰字。
   * 缺席则写 `N files`。
   */
  readonly detail?: string;
  /** 没有文件也画这组（停在半路、冲突已经清完，标题行还在）。 */
  readonly keepEmpty?: boolean;
  /** 这一行的插槽靠右（继续 / 放弃）。 */
  readonly alignEnd?: boolean;
}

export enum FileNodeKind {
  Group = "group",
  Folder = "folder",
  File = "file",
}

export type FileNode =
  | {
      readonly kind: FileNodeKind.Group;
      /** 组的 id。 */
      readonly id: string;
      readonly label: string;
      /** 组里一共几个文件。 */
      readonly count: number;
      /** 见 `FileGroup.uncheckable`。 */
      readonly uncheckable: boolean;
      readonly detail?: string;
      readonly alignEnd?: boolean;
      readonly children: readonly FileNode[];
    }
  | {
      readonly kind: FileNodeKind.Folder;
      /** 相对仓库根的目录路径，也是节点 id。 */
      readonly id: string;
      /** 合并后的显示名，比如 `apps/rgv_calib_parser`。 */
      readonly label: string;
      /** 下面（含子目录）一共几个文件。 */
      readonly count: number;
      readonly children: readonly FileNode[];
    }
  | {
      readonly kind: FileNodeKind.File;
      /** 相对仓库根的路径，也是节点 id。 */
      readonly id: string;
      /** 文件名。 */
      readonly label: string;
      /** 改名 / 复制时：同一目录写旧文件名，换了目录写旧的完整路径；其余缺席。 */
      readonly renamedFrom?: string;
      /** 平铺（不按目录分组）时所在的目录；仓库根下的、按目录分组时缺席。 */
      readonly folder?: string;
      readonly entry: FileEntry;
    };

interface Draft {
  readonly folders: Map<string, Draft>;
  readonly files: FileEntry[];
}

/**
 * `byDirectory` 为假时不按目录分组：文件直接列在组下面，按路径排（同一目录的挨在一起），
 * 记下所在目录，转成树节点时当灰字：平铺了也看得出文件在哪个目录。
 */
export function buildFileTree(
  groups: readonly FileGroup[],
  byDirectory: boolean,
): readonly FileNode[] {
  return groups.flatMap((group): FileNode[] => {
    if (group.entries.length === 0 && group.keepEmpty !== true) return [];
    const children = byDirectory ? buildEntries(group.entries) : flatEntries(group.entries);
    if (group.label === undefined) return children;
    return [
      {
        kind: FileNodeKind.Group,
        id: group.id,
        label: group.label,
        count: group.entries.length,
        uncheckable: group.uncheckable === true,
        ...(group.detail === undefined ? {} : { detail: group.detail }),
        ...(group.alignEnd === true ? { alignEnd: true } : {}),
        children,
      },
    ];
  });
}

function buildEntries(entries: readonly FileEntry[]): FileNode[] {
  const root: Draft = { folders: new Map(), files: [] };
  for (const entry of entries) {
    const parts = entry.path.split("/");
    let draft = root;
    for (const part of parts.slice(0, -1)) {
      let next = draft.folders.get(part);
      if (next === undefined) {
        next = { folders: new Map(), files: [] };
        draft.folders.set(part, next);
      }
      draft = next;
    }
    draft.files.push(entry);
  }
  return toNodes(root, "");
}

function flatEntries(entries: readonly FileEntry[]): FileNode[] {
  return [...entries]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((entry) => toFile(entry, dirname(entry.path)));
}

function toNodes(draft: Draft, prefix: string): FileNode[] {
  const folders = [...draft.folders.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, child]) => toFolder(name, child, prefix));
  const files = [...draft.files]
    .sort((a, b) => basename(a.path).localeCompare(basename(b.path)))
    .map((entry) => toFile(entry, ""));
  return [...folders, ...files];
}

function toFolder(name: string, draft: Draft, prefix: string): FileNode {
  // 合并单子目录链：自己没有文件、只有一个子目录，就把名字接上继续往下。
  let label = name;
  let current = draft;
  let path = `${prefix}${name}`;
  for (let only = soleChild(current); only !== undefined; only = soleChild(current)) {
    label = `${label}/${only[0]}`;
    path = `${path}/${only[0]}`;
    current = only[1];
  }
  const children = toNodes(current, `${path}/`);
  return { kind: FileNodeKind.Folder, id: path, label, count: countFiles(current), children };
}

function soleChild(draft: Draft): [string, Draft] | undefined {
  if (draft.files.length > 0 || draft.folders.size !== 1) return undefined;
  return [...draft.folders.entries()][0];
}

function countFiles(draft: Draft): number {
  let count = draft.files.length;
  for (const child of draft.folders.values()) count += countFiles(child);
  return count;
}

/** `folder` 是平铺时要写的所在目录，空串就不写。 */
function toFile(entry: FileEntry, folder: string): FileNode {
  const label = basename(entry.path);
  const base = {
    kind: FileNodeKind.File,
    id: entry.path,
    label,
    entry,
    ...(folder === "" ? {} : { folder }),
  } as const;
  if (entry.oldPath === undefined) return base;
  const sameFolder = dirname(entry.oldPath) === dirname(entry.path);
  return { ...base, renamedFrom: sameFolder ? basename(entry.oldPath) : entry.oldPath };
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function dirname(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

/**
 * 组的 id 前缀。路径里不会有 NUL，所以组的 id 不会和同名目录的路径撞上
 * （节点 id 在一棵树里必须唯一，见 `tree.ts`）。
 */
const GROUP_PREFIX = "\0";

/** 组在基础树里的节点 id。页面要把插槽画在某一组上时用它认那一行。 */
export function groupNodeId(id: string): string {
  return `${GROUP_PREFIX}${id}`;
}

/** 文件树 → 基础树的节点：组没有图标、文字加粗；目录是文件夹图标；文件是 Seti 图标加改动字母。 */
export function toTreeNodes(
  nodes: readonly FileNode[],
  light: boolean,
  uncheckable = false,
): TreeNode[] {
  // 不可勾选是组定的，组下面的每一层都带上。
  const flag = uncheckable ? { uncheckable: true } : {};
  return nodes.map((node): TreeNode => {
    switch (node.kind) {
      case FileNodeKind.Group: {
        const description = groupDescription(node);
        return {
          id: groupNodeId(node.id),
          label: node.label,
          bold: true,
          ...(description === undefined ? {} : { description }),
          ...(node.uncheckable ? { uncheckable: true } : {}),
          ...(node.alignEnd === true ? { alignEnd: true } : {}),
          children: toTreeNodes(node.children, light, node.uncheckable),
        };
      }
      case FileNodeKind.Folder:
        return {
          id: node.id,
          label: node.label,
          icon: codicon("folder"),
          openedIcon: codicon("folder-opened"),
          description: fileCount(node.count),
          ...flag,
          children: toTreeNodes(node.children, light, uncheckable),
        };
      case FileNodeKind.File: {
        const base = {
          id: node.id,
          label: node.label,
          icon: { kind: IconKind.Seti, ...setiIcon(node.label, light) },
          color: node.entry.color,
          decoration: node.entry.letter,
          ...flag,
        } as const;
        // 灰字只写一种：原来的（改名、冲突类型）优先，没有才写平铺时的所在目录。地方不够两样都写。
        const description =
          node.renamedFrom === undefined
            ? (node.entry.description ?? node.folder)
            : `renamed from ${node.renamedFrom}`;
        return description === undefined ? base : { ...base, description };
      }
      default:
        return assertNever(node, "toTreeNodes");
    }
  });
}

function groupDescription(node: {
  readonly detail?: string;
  readonly count: number;
}): string | undefined {
  if (node.detail === undefined) return fileCount(node.count);
  return node.detail === "" ? undefined : node.detail;
}

function fileCount(count: number): string {
  return count === 1 ? "1 file" : `${count} files`;
}

/**
 * 刷新后的勾选：按路径保持，消失的路径移出。
 * 新出现的文件本来就不在集合里，自然不勾。
 */
export function keepChecked(
  checked: ReadonlySet<string>,
  groups: readonly FileGroup[],
): ReadonlySet<string> {
  const present = new Set(
    groups
      .filter((group) => group.uncheckable !== true)
      .flatMap((group) => group.entries.map((entry) => entry.path)),
  );
  return new Set([...checked].filter((path) => present.has(path)));
}
