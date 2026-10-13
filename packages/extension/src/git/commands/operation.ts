import { stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { OperationKind } from "@dummy-git/shared";
import { classifyError, GitFailureError, run } from "../failure.js";
import { readOperation } from "../operationState.js";
import type { GitCommand } from "./command.js";
import { LockPolicy } from "./lock.js";

/**
 * 继续停着的操作。说明先写进 git 自己的说明文件，再 `--continue`。
 *
 * `GIT_EDITOR=true`：git 会把说明文件交给编辑器，`true` 立刻成功且不改内容，
 * 于是用的就是刚写进去的那份。不设的话，父进程里的编辑器可能把文件重写成别的。
 *
 * 不 `git add` 其它文件。还有冲突时 git 拒绝继续，不会悄悄标成已解决。
 *
 * `--continue` 在下一条又冲突时以非 0 退出，状态文件还在、而且换了一条提交。
 * 那是又停住了，不是失败：调用方看退出码，身份变了就当停住。
 */
export enum ContinueOutcome {
  Finished = "finished",
  Stopped = "stopped",
}

const CONTINUE: Readonly<Record<OperationKind, readonly [string, string]>> = {
  [OperationKind.Merge]: ["merge", "--continue"],
  [OperationKind.Rebase]: ["rebase", "--continue"],
  [OperationKind.CherryPick]: ["cherry-pick", "--continue"],
  [OperationKind.Revert]: ["revert", "--continue"],
};

const ABORT: Readonly<Record<OperationKind, readonly [string, string]>> = {
  [OperationKind.Merge]: ["merge", "--abort"],
  [OperationKind.Rebase]: ["rebase", "--abort"],
  [OperationKind.CherryPick]: ["cherry-pick", "--abort"],
  [OperationKind.Revert]: ["revert", "--abort"],
};

export const continueInProgress: GitCommand<
  [repository: string, gitDir: string, message: string],
  ContinueOutcome
> = {
  lock: LockPolicy.Exclusive,

  execute: async (cli, repository, gitDir, message) => {
    const before = await readOperation(gitDir);
    if (before === null) throw new Error("No operation in progress.");
    const file = await messageFile(gitDir, before.kind);
    const body = message.endsWith("\n") ? message : `${message}\n`;
    await writeFile(file, body);
    const args = CONTINUE[before.kind];
    const result = await cli.exec(args, { cwd: repository, env: { GIT_EDITOR: "true" } });
    if (result.exitCode === 0) return ContinueOutcome.Finished;
    const after = await readOperation(gitDir);
    if (after !== null && after.id !== before.id) return ContinueOutcome.Stopped;
    throw new GitFailureError(args, result.exitCode, result.stderr, classifyError(result.stderr));
  },
};

export const abortInProgress: GitCommand<[repository: string, kind: OperationKind], void> = {
  lock: LockPolicy.Exclusive,

  execute: async (cli, repository, kind) => {
    await run(cli, ABORT[kind], { cwd: repository });
  },
};

/** 说明写到哪个文件：rebase 两个后端各有各的，其余三种都是 `MERGE_MSG`。 */
async function messageFile(gitDir: string, kind: OperationKind): Promise<string> {
  if (kind !== OperationKind.Rebase) return join(gitDir, "MERGE_MSG");
  const apply = join(gitDir, "rebase-apply");
  if (await isDirectory(apply)) return join(apply, "final-commit");
  return join(gitDir, "rebase-merge", "message");
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
