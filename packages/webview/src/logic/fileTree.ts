import type { CommitFileChange } from "@dummy-git/shared";

/**
 * 右栏文件树（`.notes/design/phase-1.md` 第 5 条）：一条提交改了的文件整理成树。
 *
 * - 只有一个子目录、自己没有文件的目录链合并成一行（`apps/rgv_calib_parser`）。
 * - 目录带「下面一共几个文件」。
 * - 目录在前、文件在后，各按名字排序。
 */
export enum FileNodeKind {
  Folder = "folder",
  File = "file",
}

export type FileNode =
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
      readonly change: CommitFileChange;
    };

interface Draft {
  readonly folders: Map<string, Draft>;
  readonly files: CommitFileChange[];
}

export function buildFileTree(changes: readonly CommitFileChange[]): readonly FileNode[] {
  const root: Draft = { folders: new Map(), files: [] };
  for (const change of changes) {
    const parts = change.path.split("/");
    let draft = root;
    for (const part of parts.slice(0, -1)) {
      let next = draft.folders.get(part);
      if (next === undefined) {
        next = { folders: new Map(), files: [] };
        draft.folders.set(part, next);
      }
      draft = next;
    }
    draft.files.push(change);
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

function toFile(change: CommitFileChange): FileNode {
  const label = basename(change.path);
  const base = { kind: FileNodeKind.File, id: change.path, label, change } as const;
  if (change.oldPath === undefined) return base;
  const sameFolder = dirname(change.oldPath) === dirname(change.path);
  return { ...base, renamedFrom: sameFolder ? basename(change.oldPath) : change.oldPath };
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function dirname(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}
