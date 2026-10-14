import type { GraphStructure } from "./structure.js";
import { type GraphEdge, type GraphLines, LineStyle } from "./types.js";

/** 列表里每一行在骨架里的行号（从小到大）。不在骨架里的 hash 跳过。 */
export function visibleRows(structure: GraphStructure, hashes: readonly string[]): number[] {
  return hashes.flatMap((hash) => {
    const row = structure.rowOf.get(hash);
    return row === undefined ? [] : [row];
  });
}

/**
 * 筛选后要画的线，行号换成列表里的行号。不筛选时 `rows` 是全部行，结果全是实线。
 *
 * - 两头都看得见的父子关系：实线。
 * - 中间隔着被筛掉的提交：在完整的图上从上往下、从下往上各扫一遍，每个可见提交记住
 *   「沿被藏的路径能到的最近的可见提交」，与它连一条虚线。线性时间；能到好几个时只连最近的一个。
 * - 父提交不在骨架里（截断）：实线渐隐。沿被藏的路径一直找不到可见的祖先：虚线渐隐。
 */
export function visibleLines(structure: GraphStructure, rows: readonly number[]): GraphLines {
  const { parents, missingParents } = structure;
  const count = parents.length;
  /** 骨架行号 → 列表行号，看不见为 -1。 */
  const listRow = new Int32Array(count).fill(-1);
  rows.forEach((row, i) => {
    listRow[row] = i;
  });
  const visible = (row: number) => (listRow.at(row) ?? -1) !== -1;
  const children = parents.map((): number[] => []);
  parents.forEach((ps, row) => {
    for (const parent of ps) children.at(parent)?.push(row);
  });

  const edges: GraphEdge[] = [];
  const seen = new Set<number>();
  const connect = (up: number, down: number, style: LineStyle) => {
    const key = up * count + down;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ up: listRow.at(up) ?? -1, down: listRow.at(down) ?? -1, style });
  };
  const fades = rows.map((row) =>
    Array.from({ length: missingParents.at(row) ?? 0 }, () => LineStyle.Solid),
  );

  for (const row of rows) {
    for (const parent of parents.at(row) ?? []) {
      if (visible(parent)) connect(row, parent, LineStyle.Solid);
    }
  }

  // 从上往下：被藏的提交记住沿被藏的路径往上能到的最近的可见后代（行号最大的那个），没有为 -1。
  // 可见的提交若经被藏的子提交能到一个可见后代，而它的可见子提交没有已经连到同一个，就连一条虚线。
  // 可见提交记下的是它连上的或从可见子提交继承来的那个，用来判断后面的连线是不是多余。
  const above = new Int32Array(count).fill(-1);
  for (let row = 0; row < count; row++) {
    let hidden = -1;
    let adjacent = -1;
    for (const child of children.at(row) ?? []) {
      const reached = above.at(child) ?? -1;
      if (!visible(row)) hidden = Math.max(hidden, visible(child) ? child : reached);
      else if (visible(child)) adjacent = Math.max(adjacent, reached);
      else hidden = Math.max(hidden, reached);
    }
    if (!visible(row) || hidden === -1 || hidden === adjacent) {
      above[row] = visible(row) ? adjacent : hidden;
    } else {
      connect(hidden, row, LineStyle.Dotted);
      above[row] = hidden;
    }
  }

  // 从下往上，对称：被藏的提交记住沿被藏的路径往下能到的最近的可见祖先（行号最小的那个），没有为 `count`。
  // 可见的提交有被藏的父提交、却经它一直找不到可见的祖先：画一段虚线渐隐。
  const below = new Int32Array(count).fill(count);
  for (let row = count - 1; row >= 0; row--) {
    let hidden = count;
    let adjacent = count;
    let lost = false;
    for (const parent of parents.at(row) ?? []) {
      const reached = below.at(parent) ?? count;
      if (!visible(row)) hidden = Math.min(hidden, visible(parent) ? parent : reached);
      else if (visible(parent)) adjacent = Math.min(adjacent, reached);
      else {
        hidden = Math.min(hidden, reached);
        if (reached === count) lost = true;
      }
    }
    if (lost) fades.at(listRow.at(row) ?? -1)?.push(LineStyle.Dotted);
    if (!visible(row) || hidden === count || hidden === adjacent) {
      below[row] = visible(row) ? adjacent : hidden;
    } else {
      connect(row, hidden, LineStyle.Dotted);
      below[row] = hidden;
    }
  }

  return { edges, fades };
}
