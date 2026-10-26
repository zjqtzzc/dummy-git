import type { GitCli } from "../cli.js";
import { classifyError, GitFailureError, run } from "../failure.js";
import type { GitCommand } from "./command.js";
import { LockPolicy } from "./lock.js";

/** 快进的结果。不能快进是已知结果，不是异常：由 handler 换成一句用户看得懂的话。 */
export enum FastForwardKind {
  Done = "done",
  /** 本地与远程各自有新提交。 */
  Diverged = "diverged",
}

export type FastForwardResult =
  | { readonly kind: FastForwardKind.Done }
  | { readonly kind: FastForwardKind.Diverged; readonly stderr: string };

/**
 * 更新一个**不是当前分支**的本地分支：一条 `fetch <remote> refs/heads/<M>:refs/heads/<B>`。
 *
 * 取回远程的 `M`，同时更新远程分支记录与本地的 `B`。冒号两边不带 `+`，只允许快进；
 * 不碰暂存区与工作区。写引用，走远程道。写成完整引用名，免得和同名 tag 混淆。
 *
 * 不能用于当前分支：git 拒绝用 fetch 更新检出的分支（工作区会对不上）。
 */
export const fetchInto: GitCommand<
  [repository: string, remote: string, remoteBranch: string, localBranch: string],
  FastForwardResult
> = {
  lock: LockPolicy.Remote,

  execute: async (cli, repository, remote, remoteBranch, localBranch) => {
    const args = ["fetch", remote, `refs/heads/${remoteBranch}:refs/heads/${localBranch}`];
    // 不能快进时 git 以 1 退出，stderr 里是 `! [rejected] … (non-fast-forward)`。
    return fastForwardResult(cli, repository, args, (stderr) =>
      stderr.includes("(non-fast-forward)"),
    );
  },
};

/** 更新当前分支的第一步：只取回远程的 `M`，更新它的远程分支记录。走远程道。 */
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
 * 先看 `B` 此刻还是不是当前分支，和快进在同一条命令里：Checkout 也走本地道，插不到两步中间。
 * 调用方早先看到的「是当前分支」不作数——取远程走远程道，那段时间里用户可能已经切走了。
 * - 是：`merge --ff-only <target>`，连工作区一起更新。不能快进时 git 报 `Not possible to fast-forward`；
 *   工作区的改动挡住时（`would be overwritten`）是别的失败，原样抛出：git 那一句已经说清楚了。
 * - 不是：`fetch . <target>:refs/heads/<B>`，只移动引用、不联网，只允许快进（同 `fetchInto`）。
 */
export const fastForward: GitCommand<
  [repository: string, branch: string, target: string],
  FastForwardResult
> = {
  lock: LockPolicy.Exclusive,

  execute: async (cli, repository, branch, target) => {
    // detached 时退出码 1，`-q` 不报错：当作「不是」。
    const head = await cli.exec(["symbolic-ref", "-q", "HEAD"], { cwd: repository });
    if (head.exitCode === 0 && head.stdout.trim() === `refs/heads/${branch}`) {
      return fastForwardResult(cli, repository, ["merge", "--ff-only", target], (stderr) =>
        stderr.includes("Not possible to fast-forward"),
      );
    }
    return fastForwardResult(
      cli,
      repository,
      ["fetch", ".", `${target}:refs/heads/${branch}`],
      (stderr) => stderr.includes("(non-fast-forward)"),
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
