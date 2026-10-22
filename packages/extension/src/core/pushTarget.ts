import { assertNever, type Upstream, UpstreamState } from "@dummy-git/shared";

/**
 * 推送对话框打开时，默认推到哪里；推送时带不带 `-u`。
 *
 * 顺序：**上游 → `origin` → 第一个远程**。没有上游时推到远程的同名分支。
 * 上游在远程已被删除（gone）当作没有上游：那个分支已经不在了，没有理由还推回原来的名字。
 * 一个远程都没有时也是 `origin`：对话框里定义远程时预填的名字。
 * 只算出一个值，不执行；对话框里还能改。
 */
export interface PushTarget {
  readonly remote: string;
  readonly remoteBranch: string;
}

/** 惯例上的主远程名。 */
const ORIGIN = "origin";

/**
 * 推送时还算数的上游：gone 的返回 `undefined`。
 * 默认目标和带不带 `-u` 都从这里取，两处对「有没有上游」的回答才不会走样。
 */
export function pushUpstream(upstream: Upstream | undefined): Upstream | undefined {
  if (upstream === undefined) return undefined;
  switch (upstream.state.kind) {
    case UpstreamState.Tracking:
      return upstream;
    case UpstreamState.Gone:
      return undefined;
    default:
      return assertNever(upstream.state, "pushUpstream");
  }
}

export function defaultPushTarget(
  branch: string,
  upstream: Upstream | undefined,
  remotes: readonly string[],
): PushTarget {
  const live = pushUpstream(upstream);
  if (live !== undefined) return { remote: live.remote, remoteBranch: live.name };
  const remote = remotes.includes(ORIGIN) ? ORIGIN : (remotes[0] ?? ORIGIN);
  return { remote, remoteBranch: branch };
}
