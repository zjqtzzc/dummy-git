import { assertNever, OperationKind } from "@dummy-git/shared";
import type { GitCli } from "../cli.js";
import { classifyError, GitFailureError } from "../failure.js";
import { inSequence, readOperation } from "../operationState.js";
import type { ExecResult } from "../types.js";
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
 * 把当前分支变基到另一个分支上：`git rebase --autostash <引用> [<分支>]`。改工作区，走本地道。
 *
 * 给了分支名，git 先切到那条再变基；不给就用现在检出的这条。
 * `--autostash` 先收起已跟踪的改动，变基结束后再取回。未跟踪的文件不收。
 * 变基本身冲突时退出码非 0，状态目录还在。
 */
export const rebaseOnto: GitCommand<
  [repository: string, gitDir: string, start: string, branch: string | undefined],
  RebaseOutcome
> = {
  lock: LockPolicy.Exclusive,

  execute: async (cli, repository, gitDir, start, branch) => {
    const args =
      branch === undefined
        ? ["rebase", "--autostash", start]
        : ["rebase", "--autostash", start, branch];
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

/** 摘、撤一串提交的结果。停在冲突不是失败。 */
export enum ReplayOutcome {
  Done = "done",
  Stopped = "stopped",
}

export type ReplayResult =
  /** 做完了。`skipped` 是其中改动早已在当前分支里、自动跳过的条数。 */
  | { readonly kind: ReplayOutcome.Done; readonly skipped: number }
  | { readonly kind: ReplayOutcome.Stopped };

/** 摘还是撤。 */
export type ReplayKind = OperationKind.CherryPick | OperationKind.Revert;

/** 命令行上的子命令。 */
const REPLAY_VERB: Readonly<Record<ReplayKind, string>> = {
  [OperationKind.CherryPick]: "cherry-pick",
  [OperationKind.Revert]: "revert",
};

/**
 * 这一条的改动当前分支里已经有了（「变空」）。git 停下来让人选跳过还是留一条空提交，这时 `--continue` 过不去。
 *
 * 两种的说法不一样（git 2.43 实测）：cherry-pick 在 stderr 写 `is now empty`，留着 `CHERRY_PICK_HEAD`；
 * revert 在 stdout 写 `nothing to commit`（工作区有未跟踪文件时是 `nothing added to commit`），
 * 不留 `REVERT_HEAD`——一串里只剩 `.git/sequencer`，单条时什么都不留。
 * git 一律以英文环境运行（`cli.ts`），所以能认这几句话。
 */
export function isEmptyReplay(kind: ReplayKind, stdout: string, stderr: string): boolean {
  switch (kind) {
    case OperationKind.CherryPick:
      return stderr.includes("is now empty");
    case OperationKind.Revert:
      return /nothing (?:added )?to commit/.test(stdout);
    default:
      return assertNever(kind, "isEmptyReplay");
  }
}

/**
 * 按给的顺序摘（cherry-pick）或撤（revert）一串提交：`git <子命令> --no-edit --stdin`。改工作区，走本地道。
 *
 * hash 从 stdin 喂：Windows 的命令行最长 32767 个字符，八百来个完整 hash 就超了。
 * git 按给的顺序做、不重排；中途停在冲突时由 git 的 sequencer 记住剩下的，继续、放弃走「停在半路」现成的那套。
 * `--no-edit` 用 git 准备好的说明，不再打开编辑器。工作区已有的改动交给 git：挡路就拒绝，并且不开始。
 *
 * 变空的自动跳过、接着做下一条（它的改动当前分支里已经有了，跳过不丢东西），见 `finishReplay`。
 */
export const replayCommits: GitCommand<
  [repository: string, gitDir: string, kind: ReplayKind, hashes: readonly string[]],
  ReplayResult
> = {
  lock: LockPolicy.Exclusive,

  execute: async (cli, repository, gitDir, kind, hashes) => {
    const args = [REPLAY_VERB[kind], "--no-edit", "--stdin"];
    const result = await cli.exec(args, { cwd: repository, input: `${hashes.join("\n")}\n` });
    return finishReplay(cli, repository, gitDir, kind, args, result);
  },
};

/**
 * 接着一次 cherry-pick / revert（开始执行，或解决冲突后继续）的结果往下做：
 * 变空的自动 `--skip`、接着做下一条，直到做完或停在冲突，记下跳过了几条。
 * 解决冲突时留了当前分支那一边，这一条同样会变空：意思是不要它了，一样跳过。
 * 还有东西在进行中才 `--skip`：单条 revert 变空时 git 什么都没留，再 `--skip` 会报「没有在进行的」。
 */
export async function finishReplay(
  cli: GitCli,
  repository: string,
  gitDir: string,
  kind: ReplayKind,
  firstArgs: readonly string[],
  first: ExecResult,
): Promise<ReplayResult> {
  const verb = REPLAY_VERB[kind];
  let args = firstArgs;
  let result = first;
  let skipped = 0;
  while (result.exitCode !== 0) {
    if (!isEmptyReplay(kind, result.stdout, result.stderr)) {
      if ((await readOperation(gitDir))?.kind === kind) return { kind: ReplayOutcome.Stopped };
      throw new GitFailureError(args, result.exitCode, result.stderr, classifyError(result.stderr));
    }
    skipped += 1;
    const pending = (await inSequence(gitDir)) || (await readOperation(gitDir))?.kind === kind;
    if (!pending) break;
    args = [verb, "--skip"];
    result = await cli.exec(args, { cwd: repository });
  }
  return { kind: ReplayOutcome.Done, skipped };
}
