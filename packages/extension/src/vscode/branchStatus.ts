import { type Ref, RefKind, UpstreamState } from "@dummy-git/shared";

/**
 * 状态栏上的当前分支：`$(git-branch) main ↓2↑1`，detached 时 `$(git-commit) a1b2c3d`。
 * 已同步、没有上游、上游已删（Gone 视同无上游）都只写分支名。
 *
 * `refs` 是 HEAD 加全部引用（和 `getRefs` 请求给 webview 的同一份）。
 * 当前分支的上游只挂在本地分支那条上，所以两样都要。
 */
export function branchStatus(refs: readonly Ref[]): string | undefined {
  const head = refs.find((ref) => ref.kind === RefKind.Head);
  if (head?.kind !== RefKind.Head) return undefined;
  const { branch } = head;
  if (branch === undefined) return `$(git-commit) ${head.target.slice(0, 7)}`;

  const current = refs.find((ref) => ref.kind === RefKind.LocalBranch && ref.name === branch);
  const state = current?.kind === RefKind.LocalBranch ? current.upstream?.state : undefined;
  const text = `$(git-branch) ${branch}`;
  if (state?.kind !== UpstreamState.Tracking) return text;

  const { ahead, behind } = state;
  const sync = `${behind > 0 ? `↓${behind}` : ""}${ahead > 0 ? `↑${ahead}` : ""}`;
  return sync === "" ? text : `${text} ${sync}`;
}
