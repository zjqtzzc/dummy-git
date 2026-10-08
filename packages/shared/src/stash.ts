/**
 * 一条 stash（`git stash list` 的一条）。
 *
 * stash 是一条特殊的提交：第一个父提交是存的时候所在的提交，它的树是存进去的已跟踪文件；
 * 存了未跟踪文件时，它们在第三个父提交里（一条没有父提交的附属提交）。
 */
export interface Stash {
  readonly hash: string;
  /** 存的时候所在的提交（第一个父提交）：已跟踪文件 diff 的左边。 */
  readonly base: string;
  /** 未跟踪文件所在的附属提交（第三个父提交）；没存未跟踪文件时缺席。 */
  readonly untracked?: string;
  /** git 生成的说明，比如 `WIP on main: 1a2b3c4 fix login`。 */
  readonly message: string;
  /** 存的时间，unix 秒。 */
  readonly at: number;
}
