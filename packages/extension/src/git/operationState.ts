import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { type OngoingOperation, OperationKind } from "@dummy-git/shared";

/**
 * 停在半路的操作：读状态文件，不跑 git。
 *
 * `status` 里「You are currently rebasing」那种句子是给人看的，随版本和语言变。
 * 这些文件在，操作就还停着；不在，就结束了。
 *
 * 文件都在仓库位置的 `gitDir` 下。linked worktree 里那是
 * `…/.git/worktrees/<名字>/`，不是 `<根>/.git`。
 */

/** 不另问 git 要缩写。7 位是它历来的默认长度。 */
const SHORT = 7;

/** 一次读取喂给 `interpretOperation` 的原文。缺席 = 那个文件（或目录）不存在。 */
export interface OperationFiles {
  readonly mergeHead?: string;
  readonly mergeMessage?: string;
  readonly cherryPickHead?: string;
  readonly revertHead?: string;
  /** `rebase-merge/` 在。现代 rebase（merge 后端）用这个目录。 */
  readonly rebaseMerge?: RebaseFiles;
  /** `rebase-apply/` 在。`rebase --apply` 与 `git am` 用这个目录。 */
  readonly rebaseApply?: RebaseFiles;
}

export interface RebaseFiles {
  readonly headName?: string;
  readonly onto?: string;
  readonly message?: string;
  /** `rebase-merge/stopped-sha` 或 `rebase-apply/original-commit`。 */
  readonly stopped?: string;
}

/**
 * 五选一，rebase 目录优先于 `MERGE_HEAD`：变基停住时不看合并那几个文件。
 * 然后才是 merge、cherry-pick、revert。都没有就是 `null`。
 */
export function interpretOperation(files: OperationFiles): OngoingOperation | null {
  if (files.rebaseMerge !== undefined) return fromRebase(files.rebaseMerge);
  if (files.rebaseApply !== undefined) return fromRebase(files.rebaseApply);
  if (files.mergeHead !== undefined) return fromMerge(files.mergeHead, files.mergeMessage);
  if (files.cherryPickHead !== undefined) {
    return fromHash(OperationKind.CherryPick, files.cherryPickHead, files.mergeMessage);
  }
  if (files.revertHead !== undefined) {
    return fromHash(OperationKind.Revert, files.revertHead, files.mergeMessage);
  }
  return null;
}

/** `HEAD` 是 `ref: refs/heads/…` 时取出分支名。内容是 hash（游离）就没有名字。 */
export function branchFromHead(text: string): string | undefined {
  const line = firstLine(text);
  const prefix = "ref: refs/heads/";
  return line?.startsWith(prefix) ? line.slice(prefix.length) : undefined;
}

/**
 * 合并编辑器两栏的标题。左永远是 Current（第 2 栏），右永远是 Incoming（第 3 栏），rebase 也不对调。
 * 没有进行中的操作但有冲突（stash 取出）时，右边写 Stashed Changes。
 */
export function mergeEditorTitles(
  operation: OngoingOperation | null,
  branch: string | undefined,
): { readonly current: string; readonly incoming: string } {
  if (operation === null) {
    return {
      current: withDetail("Current", branch),
      incoming: withDetail("Incoming", "Stashed Changes"),
    };
  }
  const current = operation.kind === OperationKind.Rebase ? operation.current : branch;
  return {
    current: withDetail("Current", current),
    incoming: withDetail("Incoming", operation.incoming),
  };
}

/** 读 `gitDir` 里的状态文件。没有停着的操作是 `null`。 */
export async function readOperation(gitDir: string): Promise<OngoingOperation | null> {
  const [rebaseMerge, rebaseApply, mergeHead, mergeMessage, cherryPickHead, revertHead] =
    await Promise.all([
      readRebase(gitDir, "rebase-merge", "stopped-sha", "message"),
      readRebase(gitDir, "rebase-apply", "original-commit", "final-commit"),
      readText(join(gitDir, "MERGE_HEAD")),
      readText(join(gitDir, "MERGE_MSG")),
      readText(join(gitDir, "CHERRY_PICK_HEAD")),
      readText(join(gitDir, "REVERT_HEAD")),
    ]);
  return interpretOperation({
    ...(rebaseMerge === undefined ? {} : { rebaseMerge }),
    ...(rebaseApply === undefined ? {} : { rebaseApply }),
    ...(mergeHead === undefined ? {} : { mergeHead }),
    ...(mergeMessage === undefined ? {} : { mergeMessage }),
    ...(cherryPickHead === undefined ? {} : { cherryPickHead }),
    ...(revertHead === undefined ? {} : { revertHead }),
  });
}

/** 当前分支名。游离时缺席。 */
export async function readHeadBranch(gitDir: string): Promise<string | undefined> {
  const text = await readText(join(gitDir, "HEAD"));
  return text === undefined ? undefined : branchFromHead(text);
}

function fromRebase(files: RebaseFiles): OngoingOperation {
  const stopped = text(files.stopped);
  const onto = shortHash(files.onto);
  const subject = branchFromRef(files.headName) ?? shortHash(stopped) ?? "rebase";
  return {
    kind: OperationKind.Rebase,
    id: stopped ?? text(files.onto) ?? subject,
    subject,
    ...(onto === undefined ? {} : { current: onto }),
    incoming: shortHash(stopped) ?? subject,
    message: messageBody(files.message ?? ""),
  };
}

function fromMerge(head: string, message: string | undefined): OngoingOperation {
  const hash = text(head) ?? "";
  const subject = mergeSubject(message, hash);
  return {
    kind: OperationKind.Merge,
    id: hash === "" ? subject : hash,
    subject,
    incoming: subject,
    message: messageBody(message ?? ""),
  };
}

function fromHash(
  kind: OperationKind.CherryPick | OperationKind.Revert,
  head: string,
  message: string | undefined,
): OngoingOperation {
  const hash = text(head) ?? "";
  const subject = shortHash(hash) ?? "commit";
  return {
    kind,
    id: hash === "" ? subject : hash,
    subject,
    incoming: subject,
    message: messageBody(message ?? ""),
  };
}

/** `Merge branch 'feature'` / `Merge remote-tracking branch 'origin/feature'`。对不上就用短 hash。 */
function mergeSubject(message: string | undefined, hash: string): string {
  const line = firstLine(message) ?? "";
  const named = /^Merge (?:remote-tracking )?branch '([^']+)'/.exec(line);
  const branch = named?.[1];
  if (branch !== undefined && branch !== "") return branch;
  return shortHash(hash) ?? "merge";
}

/** `refs/heads/feature` → `feature`。`detached HEAD` 这种原样留下。 */
function branchFromRef(value: string | undefined): string | undefined {
  const line = firstLine(value);
  if (line === undefined) return undefined;
  const prefix = "refs/heads/";
  return line.startsWith(prefix) ? line.slice(prefix.length) : line;
}

/** 去掉 `#` 开头的注释行（`# Conflicts:` 那种）。说明本身原样留着。 */
function messageBody(value: string): string {
  return value
    .split(/\r?\n/)
    .filter((line) => !line.startsWith("#"))
    .join("\n")
    .trimEnd();
}

function withDetail(label: string, detail: string | undefined): string {
  return detail === undefined || detail === "" ? label : `${label} (${detail})`;
}

function shortHash(value: string | undefined): string | undefined {
  const hash = text(value);
  return hash === undefined ? undefined : hash.slice(0, SHORT);
}

function text(value: string | undefined): string | undefined {
  const line = firstLine(value);
  return line === undefined || line === "" ? undefined : line;
}

function firstLine(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const line = value.split(/\r?\n/, 1)[0]?.trim();
  return line === undefined || line === "" ? undefined : line;
}

async function readRebase(
  gitDir: string,
  directory: string,
  stoppedName: string,
  messageName: string,
): Promise<RebaseFiles | undefined> {
  const dir = join(gitDir, directory);
  if (!(await isDirectory(dir))) return undefined;
  const [headName, onto, message, stopped] = await Promise.all([
    readText(join(dir, "head-name")),
    readText(join(dir, "onto")),
    readText(join(dir, messageName)),
    readText(join(dir, stoppedName)),
  ]);
  return {
    ...(headName === undefined ? {} : { headName }),
    ...(onto === undefined ? {} : { onto }),
    ...(message === undefined ? {} : { message }),
    ...(stopped === undefined ? {} : { stopped }),
  };
}

async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isEnoent(error)) return undefined;
    throw error;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if (isEnoent(error)) return false;
    throw error;
  }
}

function isEnoent(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
