import type { Upstream } from "@dummy-git/shared";

/**
 * 推送对话框打开时，默认推到哪里（`.notes/design/phase-3.md` 第一节第 4 条）。
 *
 * 顺序：**上游 → 唯一的远程 → `origin` → 选不出来**。没有上游时推到远程的同名分支。
 * 只算出一个值，不执行。
 */
export enum PushTargetKind {
  Target = "target",
  /** 有多个远程且没有 `origin`：要用户选，目前不支持。 */
  Ambiguous = "ambiguous",
  /** 一个远程都没有。 */
  NoRemote = "noRemote",
}

export type PushTarget =
  | {
      readonly kind: PushTargetKind.Target;
      readonly remote: string;
      readonly remoteBranch: string;
    }
  | { readonly kind: PushTargetKind.Ambiguous }
  | { readonly kind: PushTargetKind.NoRemote };

/** 惯例上的主远程名。 */
const ORIGIN = "origin";

/** `remotes` 只在没有上游时才用得到（调用方没有上游时才去问 git）。 */
export function defaultPushTarget(
  branch: string,
  upstream: Upstream | undefined,
  remotes: readonly string[],
): PushTarget {
  if (upstream !== undefined) {
    return {
      kind: PushTargetKind.Target,
      remote: upstream.remote,
      remoteBranch: upstream.name,
    };
  }
  const only = remotes.length === 1 ? remotes[0] : undefined;
  const remote = only ?? (remotes.includes(ORIGIN) ? ORIGIN : undefined);
  if (remote !== undefined) {
    return { kind: PushTargetKind.Target, remote, remoteBranch: branch };
  }
  return remotes.length === 0
    ? { kind: PushTargetKind.NoRemote }
    : { kind: PushTargetKind.Ambiguous };
}
