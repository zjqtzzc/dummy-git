/**
 * 详情按需取（`ARCHITECTURE.md` 第 9 题）：可见范围再往前后各多取 `MARGIN` 行，
 * 一次交给 `getCommitDetails`；已经取到的、正在路上的都不重复要。
 */
import type { RowRange } from "../virtualList.js";

const MARGIN = 20;

export function hashesToFetch(
  hashes: readonly string[],
  visible: RowRange,
  known: ReadonlySet<string>,
): string[] {
  const start = Math.max(0, visible.start - MARGIN);
  const end = Math.min(hashes.length, visible.end + MARGIN);
  return hashes.slice(start, end).filter((hash) => !known.has(hash));
}
