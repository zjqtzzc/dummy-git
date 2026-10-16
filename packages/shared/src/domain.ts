/**
 * git 状态的分域：「哪一类数据过期了」。
 *
 * ## 为什么在 `shared/`
 *
 * 域要跨 extension ↔ webview 边界——广播事件 `domainsChanged` 带的就是它，
 * webview 据此决定要不要重新拉数据（`shared/protocol.ts`）。
 *
 * 枚举值能不能直接当对外格式，判据是「值有没有离开这次构建」：
 * extension 与 webview 是**同一份源码、同一次发布**，不算离开，所以可以直接共享枚举，
 * 不需要「内部值 → 外部字符串」的映射表。
 *
 * 映射表永不放进 `shared/`；本文件零数据表，纯声明。
 *
 * ## 域是按「下游要重新拉什么」划的，不是按 git 自己的概念
 *
 * 挑域时宁可多给一个也不要漏——漏了是界面不刷新，多给只是多跑一次查询。
 */

export enum GitDomain {
  /**
   * 分支、tag、提交图。
   *
   * 消费者：分支树（左栏）、提交列表与图（中栏）、Push 面板的 ahead 列表。
   *
   * **四个域里唯一昂贵的一个**，别顺手带上。
   * 注意它内部还差两百倍：列 ref 不到 10 ms，而提交图骨架要 1.9 秒。
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
   * 消费者：Commit 面板顶部的三条 Banner（continue / abort）。
   *
   * 单独成域是因为**代价与 `Refs` 差两个数量级**：
   * 重拉它只是看几个文件在不在，而 rebase 每重放一个提交都会动 `rebase-merge/`。
   * 不分开的话，rebase 20 个提交就是 20 次 1.9 秒的无谓重算，
   * 而界面上真正变的只有 Banner 上 `(3/7)` 那个数字。
   */
  Operation = "operation",
}
