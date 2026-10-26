import type { GitCli } from "../cli.js";
import { classifyError, GitFailureError, run } from "../failure.js";
import type { GitCommand } from "./command.js";
import { LockPolicy } from "./lock.js";

/** 快进的结果。不能快进是已知结果，不是异常：由 handler 换成一句用户看得懂的话。 */
export enum FastForwardKind {
  Done = "done",
  /** 本地与远程各自有新提交。 */
  Diverged = "diverged",
  /** 分支已经不在了（取远程时被删掉或改了名）。 */
  Missing = "missing",
}

export type FastForwardResult =
  | { readonly kind: FastForwardKind.Done }
  | { readonly kind: FastForwardKind.Diverged; readonly stderr: string }
  | { readonly kind: FastForwardKind.Missing };

/**
 * 更新分支的第一步：只取回远程的 `M`，更新它的远程分支记录，不碰本地分支。走远程道。
 * 第二步是 `fastForward`：写本地分支放在本地道，和删除、改名、Checkout 排队。
 */
export const fetchBranch: GitCommand<
  [repository: string, remote: string, remoteBranch: string],
  void
> = {
  lock: LockPolicy.Remote,

  execute: async (cli, repository, remote, remoteBranch) => {
    await run(cli, ["fetch", remote, `refs/heads/${remoteBranch}`], { cwd: repository });
  },
};

/**
 * 把本地分支 `B` 快进到 `target`（本地已有的提交，比如刚取回的远程分支记录）。走本地道。
 *
 * 先看 `B` 此刻还在不在、是不是当前分支，和快进在同一条命令里：删除、改名、Checkout 也走本地道，
 * 插不到中间。调用方早先看到的不作数——取远程走远程道，那段时间里用户可能已经删了、改了名、切走了。
 * - 不在了：什么都不做。`fetch` 写一个不存在的分支会新建它，删掉的分支就又回来了。
 * - 是：`merge --ff-only <target>`，连工作区一起更新。不能快进时 git 报 `Not possible to fast-forward`；
 *   工作区的改动挡住时（`would be overwritten`）是别的失败，原样抛出：git 那一句已经说清楚了。
 * - 不是：`fetch . <target>:refs/heads/<B>`，只移动引用、不联网；冒号两边不带 `+`，只允许快进。
 */
export const fastForward: GitCommand<
  [repository: string, branch: string, target: string],
  FastForwardResult
> = {
  lock: LockPolicy.Exclusive,

  execute: async (cli, repository, branch, target) => {
    const ref = `refs/heads/${branch}`;
    const exists = await cli.exec(["rev-parse", "--verify", "-q", ref], { cwd: repository });
    if (exists.exitCode !== 0) return { kind: FastForwardKind.Missing };
    // detached 时退出码 1，`-q` 不报错：当作「不是」。
    const head = await cli.exec(["symbolic-ref", "-q", "HEAD"], { cwd: repository });
    if (head.exitCode === 0 && head.stdout.trim() === ref) {
      return fastForwardResult(cli, repository, ["merge", "--ff-only", target], (stderr) =>
        stderr.includes("Not possible to fast-forward"),
      );
    }
    return fastForwardResult(cli, repository, ["fetch", ".", `${target}:${ref}`], (stderr) =>
      stderr.includes("(non-fast-forward)"),
    );
  },
};

async function fastForwardResult(
  cli: GitCli,
  repository: string,
  args: readonly string[],
  diverged: (stderr: string) => boolean,
): Promise<FastForwardResult> {
  const result = await cli.exec(args, { cwd: repository });
  if (result.exitCode === 0) return { kind: FastForwardKind.Done };
  if (diverged(result.stderr)) return { kind: FastForwardKind.Diverged, stderr: result.stderr };
  throw new GitFailureError(args, result.exitCode, result.stderr, classifyError(result.stderr));
}
