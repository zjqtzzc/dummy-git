import { assertNever, type Ref, RefKind } from "@dummy-git/shared";
import type { GraphStructure } from "./structure.js";

/**
 * 给每行编号：一条分支沿第一父提交走下来的提交共用一个编号，编号小的车道靠左。
 * 每行的位置由本行元素按编号排序得出，所以这里只决定左右顺序，不决定具体在第几条车道。
 */
export interface GraphLayout {
  /** 每行的编号，从 1 开始。 */
  readonly indexes: readonly number[];
  /** 编号 → 以它为主链的那个头上排第一的 ref，头上没有 ref 时为 `undefined`。分叉出来的片段不在表里。颜色按它区分。 */
  readonly mainRefs: ReadonlyMap<number, Ref | undefined>;
}

/** 头的先后：数字小的先编号、车道靠左。只把当前检出置顶，不按名字猜主干。 */
function rankOf(ref: Ref, current: string | undefined): number {
  switch (ref.kind) {
    case RefKind.LocalBranch:
      return ref.name === current ? 0 : 2;
    case RefKind.RemoteBranch:
      return 1;
    case RefKind.Tag:
      return 3;
    case RefKind.Head:
      // 游离时 HEAD 就是当前检出；附着时让位给当前分支，免得它抢走主链的颜色。
      return current === undefined ? 0 : 4;
    default:
      return assertNever(ref, "rankOf");
  }
}

export function nameOf(ref: Ref): string {
  switch (ref.kind) {
    case RefKind.RemoteBranch:
      return `${ref.remote}/${ref.name}`;
    case RefKind.LocalBranch:
    case RefKind.Tag:
      return ref.name;
    case RefKind.Head:
      return "HEAD";
    default:
      return assertNever(ref, "nameOf");
  }
}

function compareRefs(a: Ref, b: Ref, current: string | undefined): number {
  return rankOf(a, current) - rankOf(b, current) || nameOf(a).localeCompare(nameOf(b));
}

/**
 * 头 = 没有子提交的行，加上有 ref 指向的行。有 ref 的按排第一的 ref 排序，没有 ref 的排在后面、按行号。
 * 返回排好的行号，以及每个头排第一的 ref。
 */
function sortedHeads(
  structure: GraphStructure,
  refs: readonly Ref[],
): { heads: number[]; best: Map<number, Ref> } {
  const current = refs.find((ref) => ref.kind === RefKind.Head)?.branch;
  const best = new Map<number, Ref>();
  for (const ref of refs) {
    const row = structure.rowOf.get(ref.target);
    if (row === undefined) continue;
    const existing = best.get(row);
    if (existing === undefined || compareRefs(ref, existing, current) < 0) best.set(row, ref);
  }
  const hasChild = new Set(structure.parents.flat());
  const bare = structure.parents.flatMap((_, row) =>
    hasChild.has(row) || best.has(row) ? [] : [row],
  );
  const withRef = [...best]
    .sort(([, a], [, b]) => compareRefs(a, b, current))
    .map(([row]) => row);
  return { heads: [...withRef, ...bare], best };
}

export function buildLayout(structure: GraphStructure, refs: readonly Ref[]): GraphLayout {
  const { heads, best } = sortedHeads(structure, refs);
  const indexes = structure.parents.map(() => 0);
  const mainRefs = new Map<number, Ref | undefined>();
  let current = 1;
  for (const head of heads) {
    if (indexes.at(head) !== 0) continue;
    mainRefs.set(current, best.get(head));
    // 深度优先：先沿第一个还没编号的父提交走到底，一条链用一个编号；走到底换下一个编号，
    // 退回去找合并提交的其它父提交，它们开新的编号。
    const stack = [head];
    for (let row = stack.at(-1); row !== undefined; row = stack.at(-1)) {
      const firstVisit = indexes.at(row) === 0;
      if (firstVisit) indexes[row] = current;
      const next = structure.parents.at(row)?.find((parent) => indexes.at(parent) === 0);
      if (next !== undefined) {
        stack.push(next);
        continue;
      }
      if (firstVisit) current++;
      stack.pop();
    }
  }
  return { indexes, mainRefs };
}
