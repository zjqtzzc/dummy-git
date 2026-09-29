import {
  assertNever,
  type CommitFileChange,
  type DiffSide,
  DiffSideKind,
  FileStatus,
} from "@dummy-git/shared";

/**
 * 提交详情里点开一个文件：左边是父提交里的它，右边是这条提交里的它。
 *
 * 纯函数，不依赖界面框架，能在 node 下测。
 *
 * - 新增：左边不存在。删除：右边不存在。
 * - 改名 / 复制：左边用父提交里的**旧路径**。
 * - 根提交没有父提交：左边不存在。
 * - 合并提交只看第一个父提交（与 name-status 用 `--first-parent` 一致）。
 */
export function commitDiffSides(
  hash: string,
  parents: readonly string[],
  file: CommitFileChange,
): { readonly left: DiffSide; readonly right: DiffSide } {
  const parent = parents[0];
  const before: DiffSide =
    parent === undefined
      ? { kind: DiffSideKind.Missing, path: file.path }
      : { kind: DiffSideKind.Revision, hash: parent, path: file.oldPath ?? file.path };
  const after: DiffSide = { kind: DiffSideKind.Revision, hash, path: file.path };
  const missing: DiffSide = { kind: DiffSideKind.Missing, path: file.path };

  switch (file.status) {
    case FileStatus.Added:
      return { left: missing, right: after };
    case FileStatus.Deleted:
      return { left: before, right: missing };
    case FileStatus.Modified:
    case FileStatus.Renamed:
    case FileStatus.Copied:
    case FileStatus.TypeChanged:
    case FileStatus.Unchanged:
      return { left: before, right: after };
    default:
      return assertNever(file.status, "commitDiffSides");
  }
}
