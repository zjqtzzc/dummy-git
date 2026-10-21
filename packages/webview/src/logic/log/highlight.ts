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

/** View Options 里的顺序与文字（同 IDEA 的 Highlight 一节）。 */
export const HIGHLIGHT_MENU: readonly { readonly highlight: Highlight; readonly label: string }[] =
  [
    { highlight: Highlight.MyCommits, label: "My Commits" },
    { highlight: Highlight.MergeCommits, label: "Merge Commits" },
    { highlight: Highlight.CurrentBranch, label: "Current Branch" },
  ];

/**
 * 存进 `viewState` 的写法。存下来的值会离开这次构建（下个版本读它），所以 enum 的值不直接落盘，由这张表给出对外的字符串。
 */
const SAVED_HIGHLIGHT: Readonly<Record<Highlight, string>> = {
  [Highlight.MyCommits]: "my-commits",
  [Highlight.MergeCommits]: "merge-commits",
  [Highlight.CurrentBranch]: "current-branch",
};

/** 存关掉的那几种：没存过的（以后新加的）默认开着（同 IDEA：没存过的高亮取 `true`）。 */
export function saveHighlights(enabled: ReadonlySet<Highlight>): unknown {
  return {
    off: Object.values(Highlight)
      .filter((highlight) => !enabled.has(highlight))
      .map((highlight) => SAVED_HIGHLIGHT[highlight]),
  };
}

/** 读回存下的开关。认不出的当作没有，不报错（旧版本存的、被改坏的）；什么都没存时全开。 */
export function restoreHighlights(saved: unknown): ReadonlySet<Highlight> {
  const off = typeof saved === "object" && saved !== null ? Reflect.get(saved, "off") : undefined;
  const offs = Array.isArray(off) ? off : [];
  return new Set(
    Object.values(Highlight).filter((highlight) => !offs.includes(SAVED_HIGHLIGHT[highlight])),
  );
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

/**
 * 是不是我的提交：名字和邮箱都相等。两边都是 mailmap 之后的（详情的 `%aN` / `%aE`，`getIdentity` 换算过的「我」），
 * 和 User 过滤的 Me 是同一批人。没有「我」（没配名字）时都不是。
 */
export function isMine(
  author: { readonly name: string; readonly email: string },
  me: { readonly name: string; readonly email: string } | null,
): boolean {
  return me !== null && author.name === me.name && author.email === me.email;
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
