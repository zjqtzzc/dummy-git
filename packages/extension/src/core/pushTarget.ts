import type { Upstream } from "@dummy-git/shared";

/**
 * 推送对话框打开时，默认推到哪里（`.notes/design/phase-10.md` 第 4 条）。
 *
 * 顺序：**上游 → `origin` → 第一个远程**。没有上游时推到远程的同名分支。
 * 只算出一个值，不执行；对话框里还能改。一个远程都没有时是 `undefined`。
 */
export interface PushTarget {
  readonly remote: string;
  readonly remoteBranch: string;
}

/** 惯例上的主远程名。 */
const ORIGIN = "origin";

export function defaultPushTarget(
  branch: string,
  upstream: Upstream | undefined,
  remotes: readonly string[],
): PushTarget | undefined {
  if (upstream !== undefined) return { remote: upstream.remote, remoteBranch: upstream.name };
  const remote = remotes.includes(ORIGIN) ? ORIGIN : remotes[0];
  return remote === undefined ? undefined : { remote, remoteBranch: branch };
}
