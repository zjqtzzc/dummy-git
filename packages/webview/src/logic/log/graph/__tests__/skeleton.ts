import type { CommitSkeleton } from "@dummy-git/shared";

/** 按行写骨架：`["c", "b"]` 表示提交 c 的父提交是 b。时间与图无关，统一给 0。 */
export function skeleton(rows: readonly (readonly string[])[]): CommitSkeleton[] {
  return rows.map(([hash = "", ...parents]) => ({ hash, parents, at: 0 }));
}
