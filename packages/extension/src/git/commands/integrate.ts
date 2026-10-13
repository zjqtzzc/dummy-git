import { OperationKind } from "@dummy-git/shared";
import { classifyError, GitFailureError } from "../failure.js";
import { readOperation } from "../operationState.js";
import type { GitCommand } from "./command.js";
import { LockPolicy } from "./lock.js";

/** 把另一个分支合进当前分支的结果。停在冲突不是失败。 */
export enum MergeOutcome {
  UpToDate = "upToDate",
  FastForward = "fastForward",
  Merged = "merged",
  Stopped = "stopped",
}

/** 把当前分支变基到另一个分支上的结果。停在冲突、以及取回暂存改动时冲突，都不是失败。 */
export enum RebaseOutcome {
  UpToDate = "upToDate",
  Rebased = "rebased",
  Stopped = "stopped",
  StashConflict = "stashConflict",
}

/**
 * 把另一个分支合进当前分支：`git merge -m <说明> <引用>`。改工作区，走本地道。
 *
 * 引用用完整名字，不让 git 在同名分支之间猜。那样 git 自己写的说明会带上 `refs/heads/`，
 * 所以说明按显示名来写。`-m` 同时不再打开编辑器。工作区已有的改动交给 git：
 * 挡路时它拒绝，并且不开始合并；不挡路就带着那些改动做。
 *
 * 退出码 1 且已经写了合并状态，是停在冲突。
 */
export const mergeRef: GitCommand<
  [repository: string, gitDir: string, start: string, startName: string],
  MergeOutcome
> = {
  lock: LockPolicy.Exclusive,

  execute: async (cli, repository, gitDir, start, startName) => {
    const message = start.startsWith("refs/remotes/")
      ? `Merge remote-tracking branch '${startName}'`
      : `Merge branch '${startName}'`;
    const args = ["merge", "-m", message, start];
    const result = await cli.exec(args, { cwd: repository });
    if (result.exitCode === 0) return merged(result.stdout);
    if ((await readOperation(gitDir))?.kind === OperationKind.Merge) return MergeOutcome.Stopped;
    throw new GitFailureError(args, result.exitCode, result.stderr, classifyError(result.stderr));
  },
};

function merged(stdout: string): MergeOutcome {
  if (stdout.includes("Already up to date")) return MergeOutcome.UpToDate;
  if (stdout.includes("Fast-forward")) return MergeOutcome.FastForward;
  return MergeOutcome.Merged;
}

/**
 * 取回暂存改动冲突时 git 打的那句。
 *
 * 这时退出码仍是 0，变基目录已经没了，不能靠退出码或状态目录认。
 */
const AUTOSTASH_CONFLICT = "Applying autostash resulted in conflicts.";

/**
 * 把当前分支变基到另一个分支上：`git rebase --autostash <引用>`。改工作区，走本地道。
 *
 * `--autostash` 先收起已跟踪的改动，变基结束后再取回。未跟踪的文件不收。
 * 变基本身冲突时退出码非 0，状态目录还在。
 */
export const rebaseOnto: GitCommand<
  [repository: string, gitDir: string, start: string],
  RebaseOutcome
> = {
  lock: LockPolicy.Exclusive,

  execute: async (cli, repository, gitDir, start) => {
    const args = ["rebase", "--autostash", start];
    const result = await cli.exec(args, { cwd: repository });
    if (result.exitCode === 0) return rebased(result.stdout, result.stderr);
    if ((await readOperation(gitDir))?.kind === OperationKind.Rebase) return RebaseOutcome.Stopped;
    throw new GitFailureError(args, result.exitCode, result.stderr, classifyError(result.stderr));
  },
};

function rebased(stdout: string, stderr: string): RebaseOutcome {
  if (stderr.includes(AUTOSTASH_CONFLICT)) return RebaseOutcome.StashConflict;
  if (stdout.includes("is up to date")) return RebaseOutcome.UpToDate;
  return RebaseOutcome.Rebased;
}

/** 把一条提交摘过来或做一次反向提交的结果。空提交、停在冲突，都不是失败。 */
export enum ReplayOutcome {
  Done = "done",
  Stopped = "stopped",
  Empty = "empty",
}

/**
 * 改动已经在当前分支里时 git 打的那句。
 *
 * 这时退出码是 1，状态文件还在，但没有冲突。不能靠退出码当成冲突。
 */
const EMPTY_REPLAY = "is now empty";

/**
 * 把一条提交摘到当前分支：`git cherry-pick --no-edit <hash>`。改工作区，走本地道。
 *
 * `--no-edit` 用 git 准备好的说明，不再打开编辑器。工作区已有的改动交给 git：
 * 挡路时它拒绝，并且不开始；不挡路就带着那些改动做。
 *
 * 退出码非 0 且已经写了状态文件，是停住了。改动已经存在时同样停住，但没有冲突。
 */
export const cherryPickCommit: GitCommand<
  [repository: string, gitDir: string, hash: string],
  ReplayOutcome
> = {
  lock: LockPolicy.Exclusive,

  execute: async (cli, repository, gitDir, hash) => {
    const args = ["cherry-pick", "--no-edit", hash];
    const result = await cli.exec(args, { cwd: repository });
    if (result.exitCode === 0) return ReplayOutcome.Done;
    if ((await readOperation(gitDir))?.kind === OperationKind.CherryPick) {
      return replayStopped(result.stderr);
    }
    throw new GitFailureError(args, result.exitCode, result.stderr, classifyError(result.stderr));
  },
};

/**
 * 做一次反向提交：`git revert --no-edit <hash>`。改工作区，走本地道。
 *
 * `--no-edit` 用 git 准备好的说明，不再打开编辑器。工作区已有的改动交给 git，
 * 和摘一条提交同一套：挡路就拒绝，冲突就停住。
 */
export const revertCommit: GitCommand<
  [repository: string, gitDir: string, hash: string],
  ReplayOutcome
> = {
  lock: LockPolicy.Exclusive,

  execute: async (cli, repository, gitDir, hash) => {
    const args = ["revert", "--no-edit", hash];
    const result = await cli.exec(args, { cwd: repository });
    if (result.exitCode === 0) return ReplayOutcome.Done;
    if ((await readOperation(gitDir))?.kind === OperationKind.Revert) {
      return replayStopped(result.stderr);
    }
    throw new GitFailureError(args, result.exitCode, result.stderr, classifyError(result.stderr));
  },
};

function replayStopped(stderr: string): ReplayOutcome {
  return stderr.includes(EMPTY_REPLAY) ? ReplayOutcome.Empty : ReplayOutcome.Stopped;
}
