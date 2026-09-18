import { run } from "../failure.js";
import type { GitCommand } from "./command.js";
import { LockPolicy } from "./lock.js";

/**
 * 提交选中的文件。**第一条写命令。**
 *
 * ## 消息走 stdin，不走 `-m`
 *
 * `-m` 传不了控制字符，也容易在消息含引号、换行时出岔子。
 * `-F -` 把消息从 stdin 喂进去，内容原样送达，没有任何转义面。
 *
 * `message` 是**必填的位置参数**——这就是 M2 §4.3 那条约束的落实：
 * 「读 stdin 的命令，其包装函数的 input 参数必填，忘了传就编译不过」。
 *
 * 为什么非要在编译期挡：进程层分不出「/dev/null」和「立刻关闭的管道」，
 * 两者都是 EOF。空 stdin 对某些命令是**静默成功**——`git hash-object --stdin`
 * 会返回空内容的合法哈希，长得和正常哈希一模一样，用它写对象库就是静默的数据损坏。
 * commit 本身会拒绝空消息（git 自己报错），但这条纪律要对**所有**读 stdin 的命令成立。
 *
 * ## `--only` 是一条旧仓库的血泪
 *
 * IDEA 风格的提交是「勾选哪些文件就提交哪些」，与暂存区里还有什么无关。
 * 不加 `--only` 的话，用户在终端 `git add` 过的**别的**文件会被一起提交进去。
 * 旧仓库 `e004b7c` 修的正是这个：**按 pathspec 提交，不依赖 index 状态**。
 *
 * ## ⚠️ 只对未跟踪文件 `add`，已跟踪文件一律不碰 `add`
 *
 * 实测 `commit --only` 对**所有已跟踪状态**都直接工作，一个 `add` 都不需要：
 *
 * | 文件状态 | 再跑一次 `git add` | `commit --only` |
 * |---|---|---|
 * | 已修改 | 无害 | ✅ exit 0 |
 * | 已删除·未暂存 | 无害 | ✅ exit 0 |
 * | 已删除·**已暂存** | **💥 exit 128** | ✅ exit 0 |
 * | 新增·已暂存 | 无害 | ✅ exit 0 |
 * | **未跟踪** | 必需 | ❌ exit 1 |
 *
 * 那个 128 是旧仓库的真实 bug（`gitService/status.ts` 的 `commitFiles` 无差别
 * 对所有勾选路径跑 `add`）：一个「已暂存的删除」在工作区和 index 里**两处都不存在**，
 * `git add` 的 pathspec 匹配不到东西，`fatal: pathspec did not match any files`。
 * 而所有勾选路径是**同一次** `git add` 调用，于是不是一个文件提交不了，
 * 是**整批勾选的文件全部失败**，包括完全正常的那些。
 *
 * 最阴的触发路径：用户点提交 → 因别的原因失败（hook 拒绝）→ 但 `add` 那步已经成功 →
 * 用户再点一次 → 这次踩中。报错信息与用户刚做的事完全对不上。
 * **教训：重试必须幂等。** 不跑 `add` 就天然幂等；唯一的例外是未跟踪文件那次 `add`，
 * 做 Commit 面板时要盯住它。
 *
 * 这条规则让该类 bug **在结构上不可能发生**——永远不对已跟踪路径跑 `add`。
 * 它依赖 `FileChange` 把 `Untracked` 单列成一支（M3 §2.3）：
 * 旧仓库的 `getWorkingTreeChanges()` 明说「不区分 index/worktree，一个路径只出一条记录」，
 * **上层于是没有信息可做判断**，只能无差别 `add`。
 *
 * 未跟踪文件的 `add` 不在 M5 范围（M5 只做四条验证形态），到 Commit 面板那一片再补。
 *
 * ## 不返回新提交的 hash
 *
 * `git commit` 的输出（`[main abc1234] msg`）不适合解析，要拿 hash 得再跑一次
 * `rev-parse HEAD`。那会让「一条命令 = 一次 git 调用」这条简单规则破例。
 * 需要 hash 的地方由上层自己去读 HEAD。
 */
export const commit: GitCommand<
  [repository: string, message: string, paths: readonly string[]],
  void
> = {
  // 改 index 也改 HEAD，必须与别的写命令互斥。
  lock: LockPolicy.Exclusive,

  execute: async (cli, repository, message, paths) => {
    // 不做「消息是不是空」之类的防御性检查：验证只在边界做一次（CLAUDE.md §C.2），
    // 而这里在边界之内。空消息由 git 拒绝，M4 会把它包成 GitFailureError。
    await run(cli, ["commit", "--only", "-F", "-", "--", ...paths], {
      cwd: repository,
      input: message,
    });
  },
};
