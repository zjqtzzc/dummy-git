import { run } from "../failure.js";
import type { GitCommand } from "./command.js";
import { LockPolicy } from "./lock.js";

type CommitArgs = [
  repository: string,
  message: string,
  paths: readonly string[],
  /** `paths` 里的未跟踪文件，先 `add`。 */
  untracked: readonly string[],
];

function commitWith(amend: readonly string[]): GitCommand<CommitArgs, void> {
  return {
    // 改 index 也改 HEAD，必须与别的写命令互斥。
    lock: LockPolicy.Exclusive,

    execute: async (cli, repository, message, paths, untracked) => {
      if (untracked.length > 0) {
        await run(cli, ["add", "--", ...untracked], { cwd: repository });
      }
      // 不做「消息是不是空」之类的防御性检查：验证只在边界做一次，
      // 而这里在边界之内。空消息由 git 拒绝，`run()` 会把它包成 GitFailureError。
      try {
        await run(cli, ["commit", ...amend, "--only", "-F", "-", "--", ...paths], {
          cwd: repository,
          input: message,
        });
      } catch (error) {
        // 提交失败（比如钩子拒绝）：把刚 `add` 的未跟踪文件撤回，暂存区回到原样，
        // 它们在界面上仍是未跟踪。撤回本身失败也不掩盖
        // 提交的报错——那才是用户要看的。
        if (untracked.length > 0) {
          await run(cli, ["reset", "-q", "--", ...untracked], { cwd: repository }).catch(
            () => undefined,
          );
        }
        throw error;
      }
    },
  };
}

/**
 * 提交勾选的文件：勾了哪些就提交哪些，与暂存区里还有什么无关。
 *
 * ## 消息走 stdin，不走 `-m`
 *
 * `-m` 传不了控制字符，也容易在消息含引号、换行时出岔子。
 * `-F -` 把消息从 stdin 喂进去，内容原样送达，没有任何转义面。
 *
 * `message` 是**必填的位置参数**：读 stdin 的命令，输入参数必填，忘了传就编译不过。
 * 进程层分不出「/dev/null」和「立刻关闭的管道」，两者都是 EOF；空 stdin 对某些命令是
 * **静默成功**（`git hash-object --stdin` 返回空内容的合法哈希）。commit 本身会拒绝空消息，
 * 但这条纪律要对**所有**读 stdin 的命令成立。
 *
 * ## `--only`：按路径提交，不依赖暂存区
 *
 * 不加 `--only` 的话，用户在终端 `git add` 过的**别的**文件会被一起提交进去。
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
 * 那个 128：「已暂存的删除」在工作区和 index 里**两处都不存在**，`git add` 的 pathspec
 * 匹配不到东西。而所有勾选路径是**同一次** `git add` 调用，于是**整批勾选的文件全部失败**，
 * 包括完全正常的那些。永远不对已跟踪路径跑 `add`，这类失败就在结构上不可能发生——
 * 前提是 `FileChange` 把 `Untracked` 单列成一支，上层才有信息区分。
 *
 * 未跟踪文件的 `add` 由 `untracked` 参数给出：在同一次写锁里先 `add` 它们再提交，
 * 中间插不进别的写命令；`add` 失败就抛，提交不会跑。`add` 成功而提交失败（钩子拒绝）时，
 * `reset` 撤回这些文件，暂存区回到原样——重试时它们仍是未跟踪文件，照样先 `add`，
 * 重试是幂等的。
 *
 * ## 不返回新提交的 hash
 *
 * `git commit` 的输出（`[main abc1234] msg`）不适合解析，要拿 hash 得再跑一次
 * `rev-parse HEAD`。需要 hash 的地方由上层自己去读 HEAD。
 *
 * ⚠️ `paths` 不能为空：`commit --only` 不带路径时提交的是**整个暂存区**。
 * 协议边界（`ipc/protocol.guards.ts`）拒绝空列表。
 */
export const commit = commitWith([]);

/**
 * 改最近一次提交：勾选的文件按工作区现状并进去，说明换成新的。
 *
 * `paths` **可以为空**：`--amend --only` 不带路径时只改说明，暂存区里已有的改动不带进去
 * （git 文档明说的用法，实测确认）。这与 `commit` 不带路径的危险行为不同。
 */
export const amendCommit = commitWith(["--amend"]);
