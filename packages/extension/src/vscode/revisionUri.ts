import { join } from "node:path";
import { assertNever, type DiffSide, DiffSideKind, IndexStage } from "@dummy-git/shared";
import { relativeTo } from "./relativePath.js";

/**
 * 「diff 的一边」↔ URI。**这个格式的唯一定义处。**
 *
 * URI 是对外格式：VS Code 会把它存进标签页，重新加载窗口后拿回来找我们要内容。
 *
 * 本文件不 import vscode，只处理字符串，能在纯 node 下测。
 * 拼 `vscode.Uri` 的那一句在 `revisionFileSystem.ts`。
 *
 * ## 格式
 *
 * | 边 | URI |
 * |---|---|
 * | 某个提交里的文件 | `dummygit:<绝对路径>?rev=<完整 hash>` |
 * | 冲突时暂存区的一栏 | `dummygit:<绝对路径>?stage=base` / `ours` / `theirs` |
 * | 不存在 | `dummygit:<绝对路径>?empty` |
 *
 * 路径部分用文件的绝对路径：标签显示真实文件名，语言按扩展名识别。它只是名字，
 * 磁盘上不必存在（删掉、改名过的文件用那个版本里的路径）。
 */
export const REVISION_SCHEME = "dummygit";

/** 由我们提供内容的几种边。工作区文件用普通 `file:` URI，不经过这里。 */
export type RevisionSide = Extract<
  DiffSide,
  { kind: DiffSideKind.Revision | DiffSideKind.Missing | DiffSideKind.Stage }
>;

/** 查询部分的字样。改它等于让用户已开着的标签失效。 */
const REV_KEY = "rev";
const EMPTY_QUERY = "empty";
const STAGE_KEY = "stage";

/** 暂存区那一栏在 URI 里的写法。改它同样让用户已开着的标签失效。 */
const STAGE_NAME: Readonly<Record<IndexStage, string>> = {
  [IndexStage.Base]: "base",
  [IndexStage.Ours]: "ours",
  [IndexStage.Theirs]: "theirs",
};

/** 完整 hash：SHA-1 40 位，SHA-256 64 位。不接受缩写与 `HEAD^` 这类表达式。 */
const FULL_HASH = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** 一边 → URI 的两部分。`root` 是仓库根的绝对路径。 */
export function toRevisionUri(
  root: string,
  side: RevisionSide,
): { readonly fsPath: string; readonly query: string } {
  const fsPath = join(root, ...side.path.split("/"));
  switch (side.kind) {
    case DiffSideKind.Revision:
      return { fsPath, query: `${REV_KEY}=${side.hash}` };
    case DiffSideKind.Missing:
      return { fsPath, query: EMPTY_QUERY };
    case DiffSideKind.Stage:
      return { fsPath, query: `${STAGE_KEY}=${STAGE_NAME[side.stage]}` };
    default:
      return assertNever(side, "toRevisionUri");
  }
}

/**
 * URI 的两部分 → 一边。认不出就返回 `undefined`，不猜。
 *
 * 这里是边界：URI 可能来自重新加载后恢复的旧标签，也可能是别人手写的。
 */
export function parseRevisionUri(
  root: string,
  fsPath: string,
  query: string,
): RevisionSide | undefined {
  const path = relativeTo(root, fsPath);
  if (path === undefined || path === "") return undefined;

  if (query === EMPTY_QUERY) return { kind: DiffSideKind.Missing, path };

  const stagePrefix = `${STAGE_KEY}=`;
  if (query.startsWith(stagePrefix)) {
    const name = query.slice(stagePrefix.length);
    const stage = Object.values(IndexStage).find((candidate) => STAGE_NAME[candidate] === name);
    return stage === undefined ? undefined : { kind: DiffSideKind.Stage, stage, path };
  }

  const prefix = `${REV_KEY}=`;
  if (!query.startsWith(prefix)) return undefined;
  const hash = query.slice(prefix.length);
  return FULL_HASH.test(hash) ? { kind: DiffSideKind.Revision, hash, path } : undefined;
}
