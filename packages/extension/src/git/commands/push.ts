import { PushTagMode } from "@dummy-git/shared";
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

/** 一个没推上去的 tag。`summary` 是 git 的原文，如 `[rejected] (already exists)`。 */
interface RejectedTag {
  readonly name: string;
  readonly summary: string;
}

/** 分支推上去了（或已是最新）时，tag 仍可能被拒，`rejectedTags` 列出它们，通常为空。 */
export type PushResult =
  | { readonly kind: PushKind.Pushed; readonly rejectedTags: readonly RejectedTag[] }
  | { readonly kind: PushKind.UpToDate; readonly rejectedTags: readonly RejectedTag[] }
  | { readonly kind: PushKind.Rejected; readonly stderr: string };

/**
 * 把本地分支推到远程分支：`push --porcelain [-u] [--force-with-lease] [--tags | --follow-tags] <远程> refs/heads/<B>:refs/heads/<M>`。
 *
 * 写明推哪个到哪个，与是否当前分支、用户的 `push.default` 都无关；写成完整引用名，免得和同名 tag 混淆。
 * `setUpstream` 时带 `-u`，把远程分支设为上游（新分支第一次推送）。
 * `force` 时带 `--force-with-lease`：远程分支还停在本地记录的位置（上次 fetch 看到的）才覆盖，
 * 别人在那之后推上去的提交不会被冲掉。远程已有的同名 tag 它不覆盖：本地没有远程 tag 的记录，
 * lease 核对不了，git 拒掉这个 tag（`(stale info)`）。
 * 成败只看分支那一行（`--porcelain`）：tag 被拒时分支照样推上去了，退出码却是 1，
 * 不能当成分支被拒，被拒的 tag 放进结果里。
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
    tags: PushTagMode | undefined,
  ],
  PushResult
> = {
  lock: LockPolicy.Remote,

  execute: async (cli, repository, remote, localBranch, remoteBranch, setUpstream, force, tags) => {
    const refspec = `refs/heads/${localBranch}:refs/heads/${remoteBranch}`;
    const args = [
      "push",
      "--porcelain",
      ...(setUpstream ? ["-u"] : []),
      ...(force ? ["--force-with-lease"] : []),
      ...(tags === undefined ? [] : [TAG_FLAG[tags]]),
      remote,
      refspec,
    ];
    // 每个引用推没推上、为什么被拒，`--porcelain` 下都在 stdout 里。
    const result = await cli.exec(args, { cwd: repository, logStdout: true });
    const lines = refLines(result.stdout);
    const branch = lines.find((line) => line.ref === refspec);
    // 只认「远程有本地没有的提交」这一种拒绝；远程钩子拒绝（`[remote rejected]`）等原样抛出。
    if (branch?.flag === "!" && branch.summary.startsWith("[rejected]")) {
      return { kind: PushKind.Rejected, stderr: result.stderr };
    }
    // tag 不管为什么被拒（已存在、lease 核对不了、远程钩子只拦 tag），分支都已经推完了。
    const rejectedTags = lines
      .filter((line) => line.flag === "!" && line.ref.startsWith(TAGS_PREFIX))
      .map((line) => ({ name: tagName(line.ref), summary: line.summary }));
    if (result.exitCode !== 0 && rejectedTags.length === 0) {
      throw new GitFailureError(args, result.exitCode, result.stderr, classifyError(result.stderr));
    }
    return branch?.flag === "="
      ? { kind: PushKind.UpToDate, rejectedTags }
      : { kind: PushKind.Pushed, rejectedTags };
  },
};

const TAG_FLAG: Readonly<Record<PushTagMode, string>> = {
  [PushTagMode.All]: "--tags",
  [PushTagMode.Follow]: "--follow-tags",
};

const TAGS_PREFIX = "refs/tags/";

/** `refs/tags/v1:refs/tags/v1` → `v1`：取本地那一侧，推 tag 时两侧同名。 */
function tagName(ref: string): string {
  const local = ref.split(":")[0] ?? ref;
  return local.slice(TAGS_PREFIX.length);
}

interface RefLine {
  readonly flag: string;
  readonly ref: string;
  readonly summary: string;
}

/**
 * `--porcelain` 的输出里每个引用一行：`<标志>\t<本地>:<远程>\t<摘要>`。
 * 标志 `=` 是已是最新，`!` 是被拒；引用名是完整的，同名的分支和 tag 不会认错。
 * 开头的 `To <地址>`、结尾的 `Done` 没有 tab，跳过；连不上远程这类失败时一行都没有。
 */
function refLines(stdout: string): RefLine[] {
  const lines: RefLine[] = [];
  for (const line of stdout.split("\n")) {
    const [flag, ref, summary] = line.split("\t");
    if (flag !== undefined && ref !== undefined && summary !== undefined) {
      lines.push({ flag, ref, summary });
    }
  }
  return lines;
}
