import type { CommitSkeleton } from "@dummy-git/shared";

/**
 * 提交图按行号表示：第 i 行就是列表里的第 i 条提交。编号、每行的位置都只认行号，不再查 hash。
 *
 * 骨架是 `--date-order`：父提交一定排在它所有子提交的下面，所以父行号总比本行大。后面的计算依赖这一点。
 */
export interface GraphStructure {
  /** hash → 行号。 */
  readonly rowOf: ReadonlyMap<string, number>;
  /** 每行的父提交所在的行号，顺序同 `CommitSkeleton.parents`（第一父提交在前）。不在骨架里的父提交不列。 */
  readonly parents: readonly (readonly number[])[];
  /** 每行有几个父提交不在骨架里（第一万条附近被截断）。每个各画一段到行底渐隐的线。 */
  readonly missingParents: readonly number[];
}

/**
 * 重拉回来的同一条提交是否一样。hash 相同不够：`refs/replace` 与 `shallow` 不改 hash，
 * 却会改 git 报出的父提交与时间，也就改了图。
 */
export function sameCommit(a: CommitSkeleton, b: CommitSkeleton): boolean {
  return (
    a.hash === b.hash &&
    a.at === b.at &&
    a.parents.length === b.parents.length &&
    a.parents.every((parent, i) => parent === b.parents.at(i))
  );
}

export function buildStructure(skeleton: readonly CommitSkeleton[]): GraphStructure {
  const rowOf = new Map(skeleton.map((commit, row) => [commit.hash, row]));
  const parents = skeleton.map((commit) =>
    commit.parents.flatMap((hash) => {
      const row = rowOf.get(hash);
      return row === undefined ? [] : [row];
    }),
  );
  return {
    rowOf,
    parents,
    missingParents: skeleton.map(
      (commit, row) => commit.parents.length - (parents[row]?.length ?? 0),
    ),
  };
}
