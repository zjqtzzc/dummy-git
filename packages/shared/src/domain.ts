/**
 * git 状态的分域：「哪一类数据过期了」。
 *
 * ## 为什么在 `shared/`
 *
 * 域要跨 extension ↔ webview 边界——广播事件 `domainsChanged` 带的就是它，
 * webview 据此决定要不要重新拉数据（`shared/protocol.ts`）。
 *
 * ## 域是按「下游要重新拉什么」划的，不是按 git 自己的概念
 *
 * 挑域时宁可多给一个也不要漏——漏了是界面不刷新，多给只是多跑一次查询。
 */

export enum GitDomain {
  /**
   * 分支、tag、提交图。
   *
   * 消费者：分支树（左栏）、提交列表与图（中栏）。
   *
   * **四个域里唯一昂贵的一个**，别顺手带上。
   * 注意它内部还差两个数量级：列 ref 很快，提交图骨架慢得多。
   * 那个差距**不在这一层解决**（watcher 分辨不了），
   * 正确解法在消费者侧。
   */
  Refs = "refs",

  /**
   * 工作区与暂存区的改动。
   *
   * 消费者：Commit 面板的 Changes 列表。
   *
   * **`.git/index` 的变化只算这个域，绝不算 `Refs`。**
   * `git status` 自己会回写 index 刷新 stat 缓存，算进 `Refs` 就会变成
   * status → 写 index → 重拉 → 又跑 status 的回路。
   * （命令层给 `status` 传 `GIT_OPTIONAL_LOCKS=0` 是同一个回路的另一道防线，
   * 两者互不替代。）
   */
  Worktree = "worktree",

  /**
   * `git stash` 的列表。
   *
   * 消费者：Commit 面板的 Stash 模式。
   */
  Stash = "stash",

  /**
   * merge / rebase / cherry-pick 的「进行中」状态。
   *
   * 消费者：Commit 面板冲突组的标题行（继续 / 放弃）。
   *
   * 单独成域是因为**代价与 `Refs` 差两个数量级**：
   * 重拉它只是看几个文件在不在，而 rebase 每重放一个提交都会动 `rebase-merge/`。
   * 不分开的话，rebase 20 个提交就是 20 次提交图的无谓重算。
   */
  Operation = "operation",
}
