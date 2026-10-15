import { classifyError, GitFailureError } from "../failure.js";
import type { GitCommand } from "./command.js";
import { LockPolicy } from "./lock.js";

/** 推送的结果。被拒绝是已知结果，不是异常：由 handler 换成一句用户看得懂的话。 */
export enum PushKind {
  Pushed = "pushed",
  /** 远程已经和本地一样。 */
  UpToDate = "upToDate",
  /** 远程有本地没有的提交（`! [rejected]`）；force 时是远程在上次 fetch 之后又变了。 */
  Rejected = "rejected",
}

export type PushResult =
  | { readonly kind: PushKind.Pushed }
  | { readonly kind: PushKind.UpToDate }
  | { readonly kind: PushKind.Rejected; readonly stderr: string };

/**
 * 把本地分支推到远程分支：`push [-u] <远程> refs/heads/<B>:refs/heads/<M>`。
 *
 * 写明推哪个到哪个，与是否当前分支、用户的 `push.default` 都无关；写成完整引用名，免得和同名 tag 混淆。
 * `setUpstream` 时带 `-u`，把远程分支设为上游（新分支第一次推送）。只推分支，不推 tag。
 * `force` 时带 `--force-with-lease`：远程分支还停在本地记录的位置（上次 fetch 看到的）才覆盖，
 * 别人在那之后推上去的提交不会被冲掉。
 * 网络命令，走远程道：推送成功后 git 也要更新远程分支记录，和别的网络命令同时跑会撞引用锁。
 */
export const push: GitCommand<
  [
    repository: string,
    remote: string,
    localBranch: string,
    remoteBranch: string,
    setUpstream: boolean,
    force: boolean,
  ],
  PushResult
> = {
  lock: LockPolicy.Remote,

  execute: async (cli, repository, remote, localBranch, remoteBranch, setUpstream, force) => {
    const args = [
      "push",
      ...(setUpstream ? ["-u"] : []),
      ...(force ? ["--force-with-lease"] : []),
      remote,
      `refs/heads/${localBranch}:refs/heads/${remoteBranch}`,
    ];
    const result = await cli.exec(args, { cwd: repository });
    if (result.exitCode === 0) {
      return result.stderr.includes("Everything up-to-date")
        ? { kind: PushKind.UpToDate }
        : { kind: PushKind.Pushed };
    }
    // 只认「远程有本地没有的提交」这一种拒绝；远程钩子拒绝（`[remote rejected]`）等原样抛出。
    if (result.stderr.includes("! [rejected]")) {
      return { kind: PushKind.Rejected, stderr: result.stderr };
    }
    throw new GitFailureError(args, result.exitCode, result.stderr, classifyError(result.stderr));
  },
};
