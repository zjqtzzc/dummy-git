import { type Ref, RefKind } from "@dummy-git/shared";

/**
 * 远程上还没有 `remote/name` 这个分支（按本地记录的远程分支判断）：推送对话框在目标后面标 `New`。
 */
export function isNewRemoteBranch(refs: readonly Ref[], remote: string, name: string): boolean {
  return !refs.some(
    (ref) => ref.kind === RefKind.RemoteBranch && ref.remote === remote && ref.name === name,
  );
}
