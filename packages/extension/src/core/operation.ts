import { assertNever } from "@dummy-git/shared";
import { LockPolicy } from "../git/commands/index.js";

/**
 * 命令调度：**写命令分两条道互斥排队，读命令直接跑。**
 *
 * 设计依据见 `.notes/specs/locking.md` §2。
 *
 * ## 它只管正确性
 *
 * 队列不记「在跑几条」、不发事件、不提供「忙不忙」。「正在做」是用户操作层的反馈：
 * 一个用户操作可能横跨两条道（拉取当前分支 = 远程道的 fetch + 本地道的 merge），
 * 由 handler 声明，不从这里推。
 *
 * ## 它不认识任何具体 git 命令
 *
 * 唯一的输入是「锁策略」与「一个待执行的动作」。动作对它是**黑盒**——
 * 是 commit 还是 log，它不知道也不需要知道。
 * 于是加一条新 git 命令永远不必改这个文件，而并发代码正是最难改对的地方。
 */
export class CommandQueue {
  /**
   * 两条道各自的队尾。
   *
   * 排队不需要真正的锁：把每条命令**接在同一条道上一条的后面**，自然就串行了。
   * 队尾**永远不会 reject**（见 `enqueue`）——否则一次失败会让整条道断掉，
   * 后面的命令跟着失败，而失败是常事（撞外部锁、钩子拒绝、推送被拒）。
   */
  private local: Promise<void> = Promise.resolve();
  private remote: Promise<void> = Promise.resolve();

  /**
   * 跑一条命令：读命令直接开始，其余进各自的道排队。
   *
   * 排队是**无限期的，没有超时**：超时了也没有更好的处置。本地道里全是本地命令，
   * 毫秒到秒级；网络命令在远程道里，卡在网络上也不挡本地的提交。
   */
  async run<T>(lock: LockPolicy, action: () => Promise<T>): Promise<T> {
    switch (lock) {
      case LockPolicy.None:
        // 读命令不取任何锁，连队都不排。5 个并发的 log 会正确返回 5 次，
        // 那是浪费不是错误；「别跑太频繁」由上层的防抖解决。
        return action();
      case LockPolicy.Exclusive: {
        const [result, tail] = enqueue(this.local, action);
        this.local = tail;
        return result;
      }
      case LockPolicy.Remote: {
        const [result, tail] = enqueue(this.remote, action);
        this.remote = tail;
        return result;
      }
      default:
        return assertNever(lock, "CommandQueue.run");
    }
  }
}

/**
 * 把 `action` 接在 `previous` 之后，返回它的结果与新的队尾。
 *
 * 等前一条结束，成功失败都算结束——只关心「它不再占着」。
 * 新队尾**剥掉失败**：链只用来排队，不用来传递结果。不剥的话，一次失败会连锁掐死
 * 后面所有命令，还会产生未处理的 rejection。
 */
function enqueue<T>(
  previous: Promise<void>,
  action: () => Promise<T>,
): [Promise<T>, Promise<void>] {
  const result = (async () => {
    await previous;
    return action();
  })();
  return [
    result,
    result.then(
      () => undefined,
      () => undefined,
    ),
  ];
}
