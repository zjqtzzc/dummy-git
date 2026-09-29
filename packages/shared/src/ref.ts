/**
 * 引用：分支、标签、HEAD。`git for-each-ref` 的解析结果。
 *
 * 服务分支树（Local/Remote 分组、当前分支置顶、ahead/behind）与
 * Log 列表的 ref 标签。
 */

export enum RefKind {
  LocalBranch = "localBranch",
  RemoteBranch = "remoteBranch",
  Tag = "tag",
  Head = "head",
}

export enum UpstreamState {
  Tracking = "tracking",
  /** 上游配置还在，但远程分支已被删除——合并后删分支的常见结果。 */
  Gone = "gone",
}

/**
 * 本地分支跟踪的上游。
 *
 * `remote` / `name` 平铺（它们总是已知的），只有同步状态分两种。
 * 这是刻意的：把 ahead/behind 平铺上来的话，`[gone]` 就只能拿 `0/0` 冒充，
 * 与「完全同步」再也分不开。
 */
export interface Upstream {
  readonly remote: string;
  readonly name: string;
  readonly state:
    | { readonly kind: UpstreamState.Tracking; readonly ahead: number; readonly behind: number }
    | { readonly kind: UpstreamState.Gone };
}

/**
 * 四种引用。
 *
 * 三处形状是刻意的，每处都对应旧仓库一条真实的 bug：
 *
 * 1. **远程分支的 `remote` 与 `name` 分开存**，不留 `"origin/main"` 让人事后拆。
 *    从字符串无法判断它是远程分支还是一个恰好叫这名字的本地分支——
 *    旧仓库 `ad9f396`（带斜杠的本地分支被当成远程）、`da91d25`（删远程分支跑成删本地）、
 *    `01b15db`（`origin/HEAD` 被当成独立分支）三条 fix 都是这个根因。
 * 2. **`Head` 用 `branch` 的有无表示 detached**，不用 `isDetached: boolean`——
 *    后者允许 `{ isDetached: true, branch: "main" }` 这种自相矛盾的值。
 * 3. **「当前分支」只由 `Head.branch` 给出**，不在每个分支上挂 `isCurrent`——
 *    后者允许两个分支同时是当前分支。
 */
export type Ref =
  | {
      readonly kind: RefKind.LocalBranch;
      readonly name: string;
      /** 指向的提交 hash。 */
      readonly target: string;
      /** 没配上游时该字段不存在。 */
      readonly upstream?: Upstream;
    }
  | {
      readonly kind: RefKind.RemoteBranch;
      readonly remote: string;
      readonly name: string;
      readonly target: string;
    }
  | {
      readonly kind: RefKind.Tag;
      readonly name: string;
      /**
       * 指向的**提交** hash。
       *
       * 附注 tag 是独立对象，`%(objectname)` 给的是 tag 对象自己的 hash——
       * 拿它去和提交列表对照会一条都匹配不上。必须用剥壳后的 `%(*objectname)`。
       */
      readonly target: string;
      /** 附注 tag（独立对象，带说明与署名）还是轻量 tag（直接指向提交）。 */
      readonly annotated: boolean;
    }
  | {
      readonly kind: RefKind.Head;
      readonly target: string;
      /** 缺席即 detached HEAD。 */
      readonly branch?: string;
    };
