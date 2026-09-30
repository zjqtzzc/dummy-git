import { assertNever } from "@dummy-git/shared";
import { setiIcon } from "./setiIcon.js";
import { TreeIconKind, type TreeNode } from "./tree.js";

/**
 * 所有文件树共用的整理逻辑（`.notes/design/phase-2.md` 第一节）：几组文件整理成树。
 *
 * - 有标题的组画成顶层一行（`Changes  N files`），下面是它自己的目录树；空组不画。
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
}

/**
 * 一组文件。有标题时画成顶层一行；没有标题时直接铺开（Log 右栏只有这一组）。
 */
export interface FileGroup {
  /** 组的身份，在同一棵树里唯一。 */
  readonly id: string;
  readonly label?: string;
  readonly entries: readonly FileEntry[];
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
      readonly entry: FileEntry;
    };

interface Draft {
  readonly folders: Map<string, Draft>;
  readonly files: FileEntry[];
}

export function buildFileTree(groups: readonly FileGroup[]): readonly FileNode[] {
  return groups.flatMap((group): FileNode[] => {
    if (group.entries.length === 0) return [];
    const children = buildEntries(group.entries);
    if (group.label === undefined) return children;
    return [
      {
        kind: FileNodeKind.Group,
        id: group.id,
        label: group.label,
        count: group.entries.length,
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

function toNodes(draft: Draft, prefix: string): FileNode[] {
  const folders = [...draft.folders.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, child]) => toFolder(name, child, prefix));
  const files = [...draft.files]
    .sort((a, b) => basename(a.path).localeCompare(basename(b.path)))
    .map(toFile);
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

function toFile(entry: FileEntry): FileNode {
  const label = basename(entry.path);
  const base = { kind: FileNodeKind.File, id: entry.path, label, entry } as const;
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

/** 文件树 → 基础树的节点：组没有图标、文字加粗；目录是文件夹图标；文件是 Seti 图标加改动字母。 */
export function toTreeNodes(nodes: readonly FileNode[], light: boolean): TreeNode[] {
  return nodes.map((node): TreeNode => {
    switch (node.kind) {
      case FileNodeKind.Group:
        return {
          id: `${GROUP_PREFIX}${node.id}`,
          label: node.label,
          bold: true,
          description: fileCount(node.count),
          children: toTreeNodes(node.children, light),
        };
      case FileNodeKind.Folder:
        return {
          id: node.id,
          label: node.label,
          icon: { kind: TreeIconKind.Codicon, name: "folder", openedName: "folder-opened" },
          description: fileCount(node.count),
          children: toTreeNodes(node.children, light),
        };
      case FileNodeKind.File: {
        const icon = setiIcon(node.label, light);
        const base = {
          id: node.id,
          label: node.label,
          icon: { kind: TreeIconKind.Seti, char: icon.char, color: icon.color },
          color: node.entry.color,
          decoration: node.entry.letter,
        } as const;
        return node.renamedFrom === undefined
          ? base
          : { ...base, description: `renamed from ${node.renamedFrom}` };
      }
      default:
        return assertNever(node, "toTreeNodes");
    }
  });
}

function fileCount(count: number): string {
  return count === 1 ? "1 file" : `${count} files`;
}
