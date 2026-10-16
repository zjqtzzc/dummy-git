import type { CommitSkeleton } from "@dummy-git/shared";

/**
 * 能改说明的提交：
 * 从 HEAD 沿第一父提交往回走，走到合并提交就停（它自己也不算）。根提交算。
 * 只看骨架里有的：走出骨架（超过一万条、按别的分支过滤时）就停。
 */
export function rewordable(
  skeleton: readonly CommitSkeleton[],
  head: string | undefined,
): ReadonlySet<string> {
  const parents = new Map(skeleton.map((commit) => [commit.hash, commit.parents]));
  const found = new Set<string>();
  let hash = head;
  while (hash !== undefined) {
    const own = parents.get(hash);
    if (own === undefined || own.length > 1) break;
    found.add(hash);
    hash = own[0];
  }
  return found;
}
