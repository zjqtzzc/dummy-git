/**
 * 仓库状态的分域。
 *
 * ## 这是什么
 *
 * 仓库状态会自己过期——用户在自己的终端里敲了 `git commit`，我们什么都没做，
 * 但手里的答案已经错了。`watcher` 负责发现「有东西变了」，
 * 而这个枚举回答的是：**变的是哪一类，谁该重新去拉数据。**
 *
 * ## 为什么要分域，而不是一句「仓库变了」
 *
 * 因为各类数据的重拉代价差两个数量级：
 *
 * | 域 | 重拉什么 | 实测代价 |
 * | --- | --- | --- |
 * | `Refs` | 分支/tag 列表 + 提交图骨架 | **1,937 ms**（vscode 仓库 188,163 条） |
 * | `Worktree` | 一次 `git status` | 19 ms |
 * | `Stash` | `git stash list` | 毫秒级 |
 * | `Operation` | 看几个文件在不在 | 毫秒级 |
 *
 * 不分域的话，**保存一次文件就要重算整张提交图**——这是分域最主要的收益所在。
 * 数据见 `.notes/NFR.md` §5.3。
 *
 * ## 划分依据
 *
 * 按「**下游要重新拉什么**」倒推，不是按 git 自己的概念划。
 * 所以没有 `Branch` 域、没有 `Commit` 域——分支和提交都由同一批消费者一起用，
 * 分开对谁都没好处。
 *
 * 粒度的上限是另一条更硬的约束：**watcher 从路径能分辨出来多少，域就只能有多细**。
 * watcher 看到 `.git/refs/heads/main` 变了，它分不出这是新提交、分支改名、
 * `reset --hard` 还是删分支——而这四者对「提交集合变没变」的答案完全不同。
 * 所以 `Refs` 就是能产出的最细粒度，再细就是在这一层撒谎。
 * 详见 `.notes/design/M6-repository.md` §8、§13.4。
 *
 * ## 本文件零数据表
 *
 * 「哪个路径属于哪个域」的映射表**不在这里**，在 `watcher.ts`——它才是用那张表的人
 * （`CLAUDE.md` §B.3）。旧仓库把映射表和枚举放在一起，我们不继承那部分。
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
   * 正确解法在消费者侧，见 `design/M6-repository.md` §13.4。
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
   * 消费者：Commit 面板的 Shelf 标签页。
   *
   * 只管 `git stash`。IDEA 的 `.idea/shelf/` 是**磁盘上的 patch 文件、根本不碰 git**，
   * 该有自己的域（`ideaShelf`）——结论已定但本里程碑不实现，
   * 因为它的消费者还不存在。加的时机与加法见 `design/M6-repository.md` §8 末尾。
   * **不要把它并进这里**：旧仓库那么做，导致 IntelliJ 那边改动时标签页不刷新，
   * 而外部互操作正是那个功能存在的全部理由。
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
   *
   * （IntelliJ 不单独分这个域，因为它的冲突状态显示在别处。我们分，因为 Banner 在。）
   */
  Operation = "operation",
}
