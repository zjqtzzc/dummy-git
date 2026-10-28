import {
  assertNever,
  ChangeKind,
  ConflictKind,
  type DiffSide,
  DiffSideKind,
  type FileChange,
  FileStatus,
  MenuContextKey,
  type OngoingOperation,
  OperationKind,
} from "@dummy-git/shared";
import {
  exactlyOne,
  type MenuArgs,
  type MenuItem,
  MenuView,
  type MenuViews,
  menuItem,
  menuItemsContext,
} from "../menuItems.js";
import type { FileEntry, FileGroup, FileRow } from "../tree/fileTree.js";

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

/** 冲突文件怎么解决：合并编辑器解决的、保留或删除的、只能删除的。决定它的右键菜单里有什么。 */
enum ConflictResolution {
  Merge = "merge",
  KeepOrDelete = "keepOrDelete",
  DeleteOnly = "deleteOnly",
}

function resolutionOf(conflict: ConflictKind): ConflictResolution {
  switch (conflict) {
    case ConflictKind.BothModified:
    case ConflictKind.BothAdded:
      return ConflictResolution.Merge;
    case ConflictKind.BothDeleted:
      return ConflictResolution.DeleteOnly;
    case ConflictKind.AddedByUs:
    case ConflictKind.AddedByThem:
    case ConflictKind.DeletedByUs:
    case ConflictKind.DeletedByThem:
      return ConflictResolution.KeepOrDelete;
    default:
      return assertNever(conflict, "resolutionOf");
  }
}

enum FileMenuKind {
  Conflict = "conflict",
  Change = "change",
  Untracked = "untracked",
}

/** 一个文件的右键菜单要用的：它是哪一种、路径。 */
type FileMenuTarget =
  | {
      readonly kind: FileMenuKind.Conflict;
      readonly path: string;
      readonly resolution: ConflictResolution;
    }
  /** `deleted`：磁盘上已经没有这个文件（删除，含改名后又删掉新路径）。 */
  | { readonly kind: FileMenuKind.Change; readonly path: string; readonly deleted: boolean }
  | { readonly kind: FileMenuKind.Untracked; readonly path: string };

/** 冲突文件、且解决方式是给出的几种之一时，取出路径。`null` 是目录或组。 */
function conflictPath(...resolutions: readonly ConflictResolution[]) {
  return (target: FileMenuTarget | null): string | undefined =>
    target?.kind === FileMenuKind.Conflict && resolutions.includes(target.resolution)
      ? target.path
      : undefined;
}

function pathOf(kind: FileMenuKind.Change | FileMenuKind.Untracked) {
  return (target: FileMenuTarget | null): string | undefined =>
    target?.kind === kind ? target.path : undefined;
}

/** 磁盘上有这个文件时，取出路径。删除的、两边都删了的冲突没有可打开的。 */
function diskPath(target: FileMenuTarget | null): string | undefined {
  if (target === null) return undefined;
  switch (target.kind) {
    case FileMenuKind.Conflict:
      // 只能删除的就是两边都删了（DD），git 不在工作区留文件；其余冲突都留着一边。
      return target.resolution === ConflictResolution.DeleteOnly ? undefined : target.path;
    case FileMenuKind.Change:
      return target.deleted ? undefined : target.path;
    case FileMenuKind.Untracked:
      return target.path;
    default:
      return assertNever(target, "diskPath");
  }
}

/**
 * Rollback：展开看，目录、`Changes` 组等于它下面列出的全部文件。每一个都要是已跟踪的改动，
 * 混着未跟踪文件、冲突文件就不出现（全部严格）。工具栏的 Rollback 用同一份（`rollbackArgs`）。
 */
const ROLLBACK = menuItem({
  view: MenuView.Expanded,
  key: MenuContextKey.RollbackFile,
  pick: pathOf(FileMenuKind.Change),
  value: (paths) => ({ paths }),
});

/**
 * Commit 面板文件的右键菜单项，顺序无关（菜单里的顺序由 `package.json` 的 `group` 定）。
 * 除了 Open File 与 Open in Merge Editor（只对点中的一个文件），都是展开看、全部严格：
 * 目录、组等于它下面列出的全部文件，只动列出来的，不碰目录里没列出的（被忽略的文件等）；混着别的种类就不出现。
 */
const FILE_MENU: readonly MenuItem<FileMenuTarget | null>[] = [
  menuItem({
    view: MenuView.Exact,
    key: MenuContextKey.OpenFile,
    pick: diskPath,
    whole: exactlyOne,
    value: ([path]) => ({ path }),
  }),
  menuItem({
    view: MenuView.Exact,
    key: MenuContextKey.OpenMergeEditor,
    pick: conflictPath(ConflictResolution.Merge),
    whole: exactlyOne,
    value: ([path]) => ({ path }),
  }),
  menuItem({
    view: MenuView.Expanded,
    key: MenuContextKey.MarkResolved,
    pick: conflictPath(ConflictResolution.Merge),
    value: (paths) => ({ paths }),
  }),
  menuItem({
    view: MenuView.Expanded,
    key: MenuContextKey.KeepFile,
    pick: conflictPath(ConflictResolution.KeepOrDelete),
    value: (paths) => ({ paths }),
  }),
  menuItem({
    view: MenuView.Expanded,
    key: MenuContextKey.RemoveConflictFile,
    pick: conflictPath(ConflictResolution.KeepOrDelete, ConflictResolution.DeleteOnly),
    value: (paths) => ({ paths }),
  }),
  ROLLBACK,
  menuItem({
    view: MenuView.Expanded,
    key: MenuContextKey.AddUntracked,
    pick: pathOf(FileMenuKind.Untracked),
    value: (paths) => ({ paths }),
  }),
  menuItem({
    view: MenuView.Expanded,
    key: MenuContextKey.DeleteUntracked,
    pick: pathOf(FileMenuKind.Untracked),
    value: (paths) => ({ paths }),
  }),
];

/** 一行文件 → 它的右键菜单要用的：是哪一种、路径。 */
function menuTarget(row: WorkingRow): FileMenuTarget {
  switch (row.kind) {
    case WorkingRowKind.Conflict:
      return {
        kind: FileMenuKind.Conflict,
        path: row.file.path,
        resolution: resolutionOf(row.file.conflict),
      };
    case WorkingRowKind.Change:
      return row.file.status === WorkingStatus.Untracked
        ? { kind: FileMenuKind.Untracked, path: row.file.path }
        : {
            kind: FileMenuKind.Change,
            path: row.file.path,
            deleted: row.file.status === WorkingStatus.Deleted,
          };
    default:
      return assertNever(row, "menuTarget");
  }
}

/** 选中（文件树已换成文件，目录与组是 `null`）→ 各文件是哪一种；对不上的（刚没了的）也当 `null`。 */
function targetViews(
  conflicts: readonly ConflictFile[],
  files: readonly WorkingFile[],
  views: MenuViews<FileRow | null>,
): MenuViews<FileMenuTarget | null> {
  const toTarget = (row: FileRow | null): FileMenuTarget | null => {
    const found = row === null ? undefined : workingRow(conflicts, files, row);
    return found === undefined ? null : menuTarget(found);
  };
  return { exact: views.exact.map(toTarget), expanded: views.expanded.map(toTarget) };
}

/**
 * Commit 面板的右键菜单上下文：选中（两种看法；文件树已换成文件，目录与组是 `null`）→ 仓库，加上能做的各菜单项的键。
 */
export function workingMenuContext(
  repo: string,
  conflicts: readonly ConflictFile[],
  files: readonly WorkingFile[],
  views: MenuViews<FileRow | null>,
): Readonly<Record<string, string | MenuArgs>> {
  return {
    [MenuContextKey.Repo]: repo,
    ...menuItemsContext(targetViews(conflicts, files, views), FILE_MENU),
  };
}

/**
 * 工具栏 Rollback 撤哪些：和右键的 Rollback 同一份规则（`ROLLBACK`）；
 * 什么都没选时撤 `Changes` 组的全部。
 * 撤不了（选中的不全是已跟踪的改动，或没选且没有已跟踪的改动）时缺席，按钮置灰。不看勾选：勾选只管提交与 Stash。
 */
export function rollbackArgs(
  conflicts: readonly ConflictFile[],
  files: readonly WorkingFile[],
  views: MenuViews<FileRow | null>,
): { readonly paths: readonly string[] } | undefined {
  if (views.exact.length > 0) return ROLLBACK.evaluate(targetViews(conflicts, files, views));
  const tracked = files.filter((file) => file.status !== WorkingStatus.Untracked);
  return tracked.length === 0 ? undefined : { paths: tracked.map((file) => file.path) };
}

function conflictEntry(file: ConflictFile): FileEntry {
  return {
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

function toEntry(file: WorkingFile): FileEntry {
  const entry = { path: file.path, ...DISPLAY[file.status] };
  return file.oldPath === undefined ? entry : { ...entry, oldPath: file.oldPath };
}

/** 冲突组的 id。标题行上的按钮靠它认出这一行。 */
export const CONFLICTS_GROUP = "conflicts";
const CHANGES_GROUP = "changes";
const UNVERSIONED_GROUP = "unversioned";

export enum WorkingRowKind {
  Conflict = "conflict",
  Change = "change",
}

/** 树上一行对应的文件：冲突组里的是冲突文件，另外两组里的是合成后的改动。 */
export type WorkingRow =
  | { readonly kind: WorkingRowKind.Conflict; readonly file: ConflictFile }
  | { readonly kind: WorkingRowKind.Change; readonly file: WorkingFile };

/**
 * 树上的一行（哪一组的哪个路径）→ 它是哪个文件。右键菜单、工具栏 Rollback、打开 diff 都从这里认。
 * 要连组一起认：`git rm --cached` 后文件还在，同一路径在 Changes 里是删除、在 Unversioned Files 里是未跟踪。
 * 对不上的（刚没了的）是 `undefined`。
 */
export function workingRow(
  conflicts: readonly ConflictFile[],
  files: readonly WorkingFile[],
  row: FileRow,
): WorkingRow | undefined {
  const { path } = row.entry;
  if (row.group === CONFLICTS_GROUP) {
    const file = conflicts.find((candidate) => candidate.path === path);
    return file === undefined ? undefined : { kind: WorkingRowKind.Conflict, file };
  }
  if (row.group !== CHANGES_GROUP && row.group !== UNVERSIONED_GROUP) return undefined;
  const untracked = row.group === UNVERSIONED_GROUP;
  const file = files.find(
    (candidate) =>
      candidate.path === path && (candidate.status === WorkingStatus.Untracked) === untracked,
  );
  return file === undefined ? undefined : { kind: WorkingRowKind.Change, file };
}

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
      entries: conflicts.map(conflictEntry),
      uncheckable: true,
      ...(heading === undefined
        ? {}
        : {
            detail: heading.detail,
            ...(heading.keepEmpty ? { keepEmpty: true } : {}),
            ...(heading.actions ? { alignEnd: true } : {}),
          }),
    },
    { id: CHANGES_GROUP, label: "Changes", entries: tracked.map(toEntry) },
    {
      id: UNVERSIONED_GROUP,
      label: "Unversioned Files",
      entries: untracked.map(toEntry),
    },
  ];
}

/** Rollback 对话框：只列已跟踪的改动。 */
export function rollbackGroups(files: readonly WorkingFile[]): FileGroup[] {
  const tracked = files.filter((file) => file.status !== WorkingStatus.Untracked);
  return [{ id: CHANGES_GROUP, label: "Changes", entries: tracked.map(toEntry) }];
}

/**
 * 打开 Rollback 对话框时预勾哪些：只要还在 Changes 里的。
 * `requested` 是 Commit 面板刚才要撤的那些路径。
 */
export function precheckedPaths(
  requested: readonly string[],
  files: readonly WorkingFile[],
): ReadonlySet<string> {
  const tracked = new Set(
    files.filter((file) => file.status !== WorkingStatus.Untracked).map((file) => file.path),
  );
  return new Set(requested.filter((path) => tracked.has(path)));
}

/** 对话框 `data-subject` 里的预勾路径。坏掉就当成一份都没有。 */
export function parseDialogPaths(subject: string): readonly string[] {
  try {
    const raw: unknown = JSON.parse(subject);
    if (!Array.isArray(raw) || raw.some((item) => typeof item !== "string")) return [];
    return raw;
  } catch {
    return [];
  }
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
