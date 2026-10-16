import {
  assertNever,
  ChangeKind,
  ConflictKind,
  type DiffSide,
  DiffSideKind,
  type FileChange,
  FileStatus,
  MenuContextKey,
  MenuNodeValue,
  type OngoingOperation,
  OperationKind,
} from "@dummy-git/shared";
import type { FileEntry, FileGroup } from "../tree/fileTree.js";

/**
 * Commit 面板的数据：
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

/** 一个冲突文件：`git status` 的未合并条目。 */
export interface ConflictFile {
  readonly path: string;
  readonly conflict: ConflictKind;
}

/** 冲突文件，单独成组。 */
export function conflictFiles(changes: readonly FileChange[]): ConflictFile[] {
  return changes.flatMap((change) =>
    change.kind === ChangeKind.Conflict ? [{ path: change.path, conflict: change.conflict }] : [],
  );
}

/**
 * 双击能不能用合并编辑器解决：两边都有内容的才行（两边都改、两边都新增）。
 * 一边删了一边改了、只有一边有的、两边都删了的，没有两栏可比，改为选保留或删除。
 */
export function opensMergeEditor(conflict: ConflictKind): boolean {
  switch (conflict) {
    case ConflictKind.BothModified:
    case ConflictKind.BothAdded:
      return true;
    case ConflictKind.BothDeleted:
    case ConflictKind.AddedByUs:
    case ConflictKind.AddedByThem:
    case ConflictKind.DeletedByUs:
    case ConflictKind.DeletedByThem:
      return false;
    default:
      return assertNever(conflict, "opensMergeEditor");
  }
}

/** 冲突类型 → 文件名后面的灰字，照 `git status` 的叫法。 */
const CONFLICT_TEXT: Readonly<Record<ConflictKind, string>> = {
  [ConflictKind.BothModified]: "both modified",
  [ConflictKind.BothAdded]: "both added",
  [ConflictKind.BothDeleted]: "both deleted",
  [ConflictKind.AddedByUs]: "added by us",
  [ConflictKind.AddedByThem]: "added by them",
  [ConflictKind.DeletedByUs]: "deleted by us",
  [ConflictKind.DeletedByThem]: "deleted by them",
};

/** 冲突文件的右键菜单是哪一种：合并编辑器解决的、保留或删除的、只能删除的。 */
function conflictMenu(conflict: ConflictKind): string {
  switch (conflict) {
    case ConflictKind.BothModified:
    case ConflictKind.BothAdded:
      return MenuNodeValue.ConflictMerge;
    case ConflictKind.BothDeleted:
      return MenuNodeValue.ConflictBothDeleted;
    case ConflictKind.AddedByUs:
    case ConflictKind.AddedByThem:
    case ConflictKind.DeletedByUs:
    case ConflictKind.DeletedByThem:
      return MenuNodeValue.ConflictDeleted;
    default:
      return assertNever(conflict, "conflictMenu");
  }
}

/** 一个文件的右键菜单上下文：和 `package.json` 菜单项的 `when` 条件对应。 */
function fileMenu(repo: string, path: string, node: string): Readonly<Record<string, string>> {
  return { [MenuContextKey.Node]: node, [MenuContextKey.Repo]: repo, [MenuContextKey.Path]: path };
}

function conflictEntry(repo: string, file: ConflictFile): FileEntry {
  return {
    menu: fileMenu(repo, file.path, conflictMenu(file.conflict)),
    path: file.path,
    // 同资源管理器与源代码管理：冲突是 `!` 加冲突色。
    letter: "!",
    color: "var(--vscode-gitDecoration-conflictingResourceForeground)",
    description: CONFLICT_TEXT[file.conflict],
  };
}

/**
 * 两列合成一个。冲突另算（`conflictFiles`），这里跳过。
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

function toEntry(repo: string, file: WorkingFile): FileEntry {
  const node =
    file.status === WorkingStatus.Untracked ? MenuNodeValue.Untracked : MenuNodeValue.Change;
  const entry = { path: file.path, ...DISPLAY[file.status], menu: fileMenu(repo, file.path, node) };
  return file.oldPath === undefined ? entry : { ...entry, oldPath: file.oldPath };
}

/** 冲突组的 id。标题行上的按钮靠它认出这一行。 */
export const CONFLICTS_GROUP = "conflicts";

/**
 * 冲突组标题。
 * 没有操作也没有冲突时缺席，组不画。
 */
export interface ConflictHeading {
  readonly label: string;
  /** 标题后的灰字。空字符串表示不写。 */
  readonly detail: string;
  /** 冲突已经清完，标题行还在。 */
  readonly keepEmpty: boolean;
  /** 继续 / 放弃。stash 取出冲突没有这两个按钮。 */
  readonly actions: boolean;
  /** 没有冲突文件时才能继续。 */
  readonly canContinue: boolean;
}

export function conflictHeading(
  operation: OngoingOperation | null,
  conflictCount: number,
): ConflictHeading | undefined {
  if (operation === null && conflictCount === 0) return undefined;
  if (operation === null) {
    return {
      label: "Conflicts",
      detail: `· ${conflictCount}`,
      keepEmpty: false,
      actions: false,
      canContinue: false,
    };
  }
  return {
    label: operationTitle(operation),
    detail:
      conflictCount === 0
        ? ""
        : `· ${conflictCount} ${conflictCount === 1 ? "conflict" : "conflicts"}`,
    keepEmpty: conflictCount === 0,
    actions: true,
    canContinue: conflictCount === 0,
  };
}

function operationTitle(operation: OngoingOperation): string {
  switch (operation.kind) {
    case OperationKind.Merge:
      return `Merging ${operation.subject}`;
    case OperationKind.Rebase:
      return `Rebasing ${operation.subject}`;
    case OperationKind.CherryPick:
      return `Cherry-picking ${operation.subject}`;
    case OperationKind.Revert:
      return `Reverting ${operation.subject}`;
    default:
      return assertNever(operation.kind, "operationTitle");
  }
}

/**
 * 从上到下 `Conflicts`（不可勾选）、`Changes`（已跟踪）、`Unversioned Files`（未跟踪）三组。
 * 空组由树自己不画；停在半路且冲突已清完时冲突组仍留着标题行。
 */
export function workingGroups(
  repo: string,
  conflicts: readonly ConflictFile[],
  files: readonly WorkingFile[],
  operation: OngoingOperation | null = null,
): FileGroup[] {
  const tracked = files.filter((file) => file.status !== WorkingStatus.Untracked);
  const untracked = files.filter((file) => file.status === WorkingStatus.Untracked);
  const heading = conflictHeading(operation, conflicts.length);
  return [
    {
      id: CONFLICTS_GROUP,
      label: heading?.label ?? "Conflicts",
      entries: conflicts.map((file) => conflictEntry(repo, file)),
      uncheckable: true,
      ...(heading === undefined
        ? {}
        : {
            detail: heading.detail,
            ...(heading.keepEmpty ? { keepEmpty: true } : {}),
            ...(heading.actions ? { alignEnd: true } : {}),
          }),
    },
    { id: "changes", label: "Changes", entries: tracked.map((file) => toEntry(repo, file)) },
    {
      id: "unversioned",
      label: "Unversioned Files",
      entries: untracked.map((file) => toEntry(repo, file)),
    },
  ];
}

/**
 * 双击打开的 diff：左边 HEAD 版本，右边工作区里的真实文件
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
