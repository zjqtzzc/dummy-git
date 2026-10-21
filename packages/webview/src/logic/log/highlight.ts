import type { CommitSkeleton } from "@dummy-git/shared";

/** 提交列表的三种高亮，各自能开关。 */
export enum Highlight {
  /** 我的提交：作者那一列加粗。 */
  MyCommits = "myCommits",
  /** 合并提交：文字变灰。 */
  MergeCommits = "mergeCommits",
  /** 当前分支上的提交：浅色背景。 */
  CurrentBranch = "currentBranch",
}

/**
 * 骨架里 HEAD 包含的提交：从起点（`getHeadBases`）沿全部父提交往下走，走到的都算，起点自己也算。
 * 只在骨架里走：父提交不在骨架里（超过一万条）就停在那儿，那些本来也不显示。
 */
export function headReach(
  skeleton: readonly CommitSkeleton[],
  bases: readonly string[],
): ReadonlySet<string> {
  const parents = new Map(skeleton.map((commit) => [commit.hash, commit.parents]));
  const found = new Set<string>();
  const pending = [...bases];
  for (let hash = pending.pop(); hash !== undefined; hash = pending.pop()) {
    const own = parents.get(hash);
    if (own === undefined || found.has(hash)) continue;
    found.add(hash);
    pending.push(...own);
  }
  return found;
}

/** 一行的样式：三种高亮各管一样（背景、文字颜色、字形），互不冲突，全叠上。 */
export interface RowHighlight {
  readonly tinted: boolean;
  readonly dimmed: boolean;
  readonly bold: boolean;
}

/** 这一行是什么样的提交。 */
export interface RowFacts {
  readonly inHead: boolean;
  readonly merge: boolean;
  readonly mine: boolean;
}

/**
 * 一行的样式：关掉的高亮不起作用。不看选中：选中的行由样式表让选中色压过背景与灰字，加粗照旧。
 */
export function rowHighlight(facts: RowFacts, enabled: ReadonlySet<Highlight>): RowHighlight {
  return {
    tinted: facts.inHead && enabled.has(Highlight.CurrentBranch),
    dimmed: facts.merge && enabled.has(Highlight.MergeCommits),
    bold: facts.mine && enabled.has(Highlight.MyCommits),
  };
}
