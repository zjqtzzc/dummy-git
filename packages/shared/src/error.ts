/**
 * git 命令失败的分类。`git/failure.ts` 的分类结果。
 *
 *
 * ## 为什么这是个闭集，而 git 的错误是开放集
 *
 * git 的错误文案没有任何稳定性保证——措辞会变、会本地化、新版本会加新错误。
 * 所以**认不出来是常态，不是故障**：分类函数对不认识的 stderr 返回 `undefined`。
 *
 * 因此这里**没有 `Unknown` 成员**。加一个，就等于让「我不知道」伪装成一个结论，
 * 下游会对它写 `case`、做决策。`undefined` 做不到这一点，这是刻意的。
 *
 * （与 parser 刻意不对称：parser 遇未知 wire 值**抛异常**，因为那说明
 * 我们和 git 的协议被破坏了；这里只是没认出一句人话，不是故障。）
 *
 * ## 为什么只有两个
 *
 * 判据：**加一个错误码的前提，是下游会据此做不同的事。**
 * 只是「把 stderr 显示出来」不算——那不需要分类。
 *
 * 按这条尺子，绝大多数 git 错误都不该进来：
 *
 * - `Authentication failed` / `detected dubious ownership in repository at ...` /
 *   `Repository not found` —— 这些 stderr 本身就说得清楚，显示原文不损失信息。
 * - `bad config file line 3 in .git/config` —— 同上，且没有任何专属处置。
 *
 * 很多错误**必须知道当时在跑什么命令**才能判定（cherry-pick 冲突与 stash 冲突的
 * stderr 可能一模一样，区别只在上下文）。那些归命令层——它本来就知道自己是 push 还是 stash。
 *
 * 需要新码时加一行正则即可。**留着没有消费者的码更糟**：
 * 它会让人误以为「这里已经处理过认证错误了」。
 */
export enum GitErrorCode {
  /**
   * 目标目录不是 git 仓库，或仓库已消失（被删、被移动、盘符掉了）。
   *
   * **本闭集里唯一带来真实行为差异的码。** `Repository` 据此把该仓库置为 Disposed——
   * 停止一切刷新与重试，而不是反复对一个不存在的仓库跑命令、反复报错。
   */
  NotAGitRepository = "notAGitRepository",

  /**
   * 另一个 git 进程正持有 `.git/index.lock`。
   *
   * 它不带来行为差异，
   * 保留是因为**这是唯一一个「原始 stderr 会主动误导用户」的错误**：
   *
   * ```
   * fatal: Unable to create '.../.git/index.lock': File exists.   ← 通知里只显示这行
   *                                                               ← 空行
   * Another git process seems to be running in this repository…   ← 有用的在这儿
   * ```
   *
   * 弹通知只显示一行时，用户看到的恰好是最不可操作的那句——他不会想到
   * 是自己终端里那条命令。
   */
  RepositoryIsLocked = "repositoryIsLocked",
}
