/**
 * Log 的过滤里要问 git 的条件（`matchCommits`）。一次问一个，页面把几种的结果取交集。
 * 日期不在这里：骨架里有时间，页面自己筛。
 */
export enum MatchKind {
  /** 说明里含有这段字（不分大小写、按普通文字）。 */
  Text = "text",
  /** 作者是这个人（名字与邮箱）。 */
  Author = "author",
  /** 改过这个目录或文件。 */
  Path = "path",
}

export type MatchCondition =
  | { readonly kind: MatchKind.Text; readonly text: string }
  | { readonly kind: MatchKind.Author; readonly name: string; readonly email: string }
  /** `path` 相对仓库根、`/` 分隔。 */
  | { readonly kind: MatchKind.Path; readonly path: string };

/** User 按钮选出的作者。`me` 表示选的是「Me」那一项（按钮上写 `Me`，不写名字）。 */
export interface PickedAuthor {
  readonly name: string;
  readonly email: string;
  readonly me: boolean;
}
