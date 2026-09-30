import {
  assertNever,
  ChangeKind,
  type DiffSide,
  DiffSideKind,
  type FileChange,
  FileStatus,
} from "@dummy-git/shared";
import type { FileEntry, FileGroup } from "../tree/fileTree.js";

/**
 * Commit 面板的数据（`.notes/design/phase-2.md` 第二节第 3、5 条）：
 * 界面不区分暂存区，只看 HEAD ↔ 工作区文件，把 `git status` 的两列合成一个结果。
 */
export enum WorkingStatus {
  Added = "added",
  Modified = "modified",
  Deleted = "deleted",
  Renamed = "renamed",
  Untracked = "untracked",
}

/** 合成之后的一个文件。 */
export interface WorkingFile {
  readonly path: string;
  /** 仅 `Renamed` 时存在，是 HEAD 里的路径。 */
  readonly oldPath?: string;
  readonly status: WorkingStatus;
}

/**
 * 两列合成一个。冲突第 7 阶段才显示，这里跳过。
 *
 * - 工作区删了：删除。但新增 / 复制后又在磁盘上删掉（`AD`），HEAD 与工作区都没有，
 *   不显示；改名后又删掉，算删除 HEAD 里的旧路径。
 * - 否则照暂存区：新增、复制算新增，删除算删除，改名算改名。
 * - 暂存区没有结构变化的：修改（含类型改变）；`git add -N` 的算新增。
 */
export function workingFiles(changes: readonly FileChange[]): WorkingFile[] {
  return changes.flatMap((change): WorkingFile[] => {
    switch (change.kind) {
      case ChangeKind.Untracked:
        return [{ path: change.path, status: WorkingStatus.Untracked }];
      case ChangeKind.Conflict:
        return [];
      case ChangeKind.Tracked:
        return merge(change.path, change.oldPath, change.index, change.worktree);
      default:
        return assertNever(change, "workingFiles");
    }
  });
}

function merge(
  path: string,
  oldPath: string | undefined,
  index: FileStatus,
  worktree: FileStatus,
): WorkingFile[] {
  if (worktree === FileStatus.Deleted) {
    switch (index) {
      // HEAD 里本来就没有这个路径。
      case FileStatus.Added:
      case FileStatus.Copied:
        return [];
      case FileStatus.Renamed:
        return oldPath === undefined ? [] : [{ path: oldPath, status: WorkingStatus.Deleted }];
      case FileStatus.Unchanged:
      case FileStatus.Modified:
      case FileStatus.Deleted:
      case FileStatus.TypeChanged:
        return [{ path, status: WorkingStatus.Deleted }];
      default:
        return assertNever(index, "merge");
    }
  }
  switch (index) {
    case FileStatus.Added:
    case FileStatus.Copied:
      return [{ path, status: WorkingStatus.Added }];
    case FileStatus.Deleted:
      return [{ path, status: WorkingStatus.Deleted }];
    case FileStatus.Renamed:
      return oldPath === undefined
        ? [{ path, status: WorkingStatus.Added }]
        : [{ path, oldPath, status: WorkingStatus.Renamed }];
    case FileStatus.Unchanged:
    case FileStatus.Modified:
    case FileStatus.TypeChanged:
      // `git add -N` 的文件：暂存区没变，工作区是新增。
      return [
        {
          path,
          status: worktree === FileStatus.Added ? WorkingStatus.Added : WorkingStatus.Modified,
        },
      ];
    default:
      return assertNever(index, "merge");
  }
}

/** 改动类型 → 右侧字母与 git 装饰色（与资源管理器、源代码管理的配色一致）。 */
const DISPLAY: Readonly<
  Record<WorkingStatus, { readonly letter: string; readonly color: string }>
> = {
  [WorkingStatus.Added]: {
    letter: "A",
    color: "var(--vscode-gitDecoration-addedResourceForeground)",
  },
  [WorkingStatus.Modified]: {
    letter: "M",
    color: "var(--vscode-gitDecoration-modifiedResourceForeground)",
  },
  [WorkingStatus.Deleted]: {
    letter: "D",
    color: "var(--vscode-gitDecoration-deletedResourceForeground)",
  },
  [WorkingStatus.Renamed]: {
    letter: "R",
    color: "var(--vscode-gitDecoration-renamedResourceForeground)",
  },
  [WorkingStatus.Untracked]: {
    letter: "U",
    color: "var(--vscode-gitDecoration-untrackedResourceForeground)",
  },
};

function toEntry(file: WorkingFile): FileEntry {
  const entry = { path: file.path, ...DISPLAY[file.status] };
  return file.oldPath === undefined ? entry : { ...entry, oldPath: file.oldPath };
}

/** 分成 `Changes`（已跟踪）与 `Unversioned Files`（未跟踪）两组。空组由树自己不画。 */
export function workingGroups(files: readonly WorkingFile[]): FileGroup[] {
  const tracked = files.filter((file) => file.status !== WorkingStatus.Untracked);
  const untracked = files.filter((file) => file.status === WorkingStatus.Untracked);
  return [
    { id: "changes", label: "Changes", entries: tracked.map(toEntry) },
    { id: "unversioned", label: "Unversioned Files", entries: untracked.map(toEntry) },
  ];
}

/**
 * 双击打开的 diff（`.notes/design/phase-2.md` 第二节第 10 条）：左边 HEAD 版本，右边工作区里的真实文件
 * （能直接编辑）。新增、未跟踪的左边空；删除的右边空；改名的左边用 HEAD 里的旧路径。
 * `head` 缺席（还没有任何提交）时左边一律空。
 */
export function workingDiffSides(
  head: string | undefined,
  file: WorkingFile,
): { readonly left: DiffSide; readonly right: DiffSide } {
  const inHead = (path: string): DiffSide =>
    head === undefined
      ? { kind: DiffSideKind.Missing, path }
      : { kind: DiffSideKind.Revision, hash: head, path };
  const missing: DiffSide = { kind: DiffSideKind.Missing, path: file.path };
  const working: DiffSide = { kind: DiffSideKind.WorkingTree, path: file.path };
  switch (file.status) {
    case WorkingStatus.Added:
    case WorkingStatus.Untracked:
      return { left: missing, right: working };
    case WorkingStatus.Deleted:
      return { left: inHead(file.path), right: missing };
    case WorkingStatus.Renamed:
      return { left: inHead(file.oldPath ?? file.path), right: working };
    case WorkingStatus.Modified:
      return { left: inHead(file.path), right: working };
    default:
      return assertNever(file.status, "workingDiffSides");
  }
}
