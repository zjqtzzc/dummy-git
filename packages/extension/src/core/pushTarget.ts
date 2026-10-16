import type { Upstream } from "@dummy-git/shared";

/**
 * 推送对话框打开时，默认推到哪里。
 *
 * 顺序：**上游 → `origin` → 第一个远程**。没有上游时推到远程的同名分支。
 * 一个远程都没有时也是 `origin`：对话框里定义远程时预填的名字。
 * 只算出一个值，不执行；对话框里还能改。
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
): PushTarget {
  if (upstream !== undefined) return { remote: upstream.remote, remoteBranch: upstream.name };
  const remote = remotes.includes(ORIGIN) ? ORIGIN : (remotes[0] ?? ORIGIN);
  return { remote, remoteBranch: branch };
}
