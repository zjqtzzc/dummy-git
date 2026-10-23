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
 * 把本地分支推到远程分支：`push --porcelain [-u] <远程> refs/heads/<B>:refs/heads/<M>`。
 *
 * 写明推哪个到哪个，与是否当前分支、用户的 `push.default` 都无关；写成完整引用名，免得和同名 tag 混淆。
 * `setUpstream` 时带 `-u`，把远程分支设为上游（新分支第一次推送）。只推分支，不推 tag。
 * `force` 时带 `--force-with-lease`：远程分支还停在本地记录的位置（上次 fetch 看到的）才覆盖，
 * 别人在那之后推上去的提交不会被冲掉。
 * 结果只看分支那一行（`--porcelain`，见 `branchLine`）：同一次推送里别的引用（比如 tag）被拒时，
 * 分支照样推上去了，退出码却是 1，不能当成分支被拒。
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
    const refspec = `refs/heads/${localBranch}:refs/heads/${remoteBranch}`;
    const args = [
      "push",
      "--porcelain",
      ...(setUpstream ? ["-u"] : []),
      ...(force ? ["--force-with-lease"] : []),
      remote,
      refspec,
    ];
    // 每个引用推没推上、为什么被拒，`--porcelain` 下都在 stdout 里。
    const result = await cli.exec(args, { cwd: repository, logStdout: true });
    const line = branchLine(result.stdout, refspec);
    // 只认「远程有本地没有的提交」这一种拒绝；远程钩子拒绝（`[remote rejected]`）等原样抛出。
    if (line?.flag === "!" && line.summary.startsWith("[rejected]")) {
      return { kind: PushKind.Rejected, stderr: result.stderr };
    }
    if (result.exitCode !== 0) {
      throw new GitFailureError(args, result.exitCode, result.stderr, classifyError(result.stderr));
    }
    return line?.flag === "=" ? { kind: PushKind.UpToDate } : { kind: PushKind.Pushed };
  },
};

/**
 * `--porcelain` 的输出里找这个 refspec 那一行：`<标志>\t<本地>:<远程>\t<摘要>`。
 * 标志 `=` 是已是最新，`!` 是被拒；引用名是完整的，同名的分支和 tag 不会认错。
 * 连不上远程这类失败时一行都没有。
 */
function branchLine(
  stdout: string,
  refspec: string,
): { flag: string; summary: string } | undefined {
  for (const line of stdout.split("\n")) {
    const [flag, ref, summary] = line.split("\t");
    if (ref === refspec && flag !== undefined && summary !== undefined) return { flag, summary };
  }
  return undefined;
}
