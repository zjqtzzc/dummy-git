import { assertNever } from "@dummy-git/shared";
import { LockPolicy } from "../git/commands/lock.js";

/**
 * 命令调度：**写命令互斥排队，读命令直接跑。**
 *
 * 设计依据见 `.notes/design/M5-commands-operation.md` §3.3 与 `.notes/design/locking.md` §2。
 *
 * ## 它只有一个概念
 *
 * 队列不记「在跑几条」、不发事件、不提供「忙不忙」。那些曾经都在这里，
 * 2026-09-18 全部砍掉——地基期没有任何消费者，真正的消费者是垂直切片期的
 * 进度条。届时再加，那时才知道它要的是粗粒度（一个布尔）还是细粒度（哪条命令）。
 * 现在造是在用猜的那个，而留着一个没人用的接口，M6/M7 的实现者会把东西接上去，
 * 又一次把假设变成既成事实（`CLAUDE.md` D.7/D.9）。
 *
 * ## 它不认识任何具体 git 命令
 *
 * 唯一的输入是「锁策略」与「一个待执行的动作」。动作对它是**黑盒**——
 * 是 commit 还是 log，它不知道也不需要知道。
 * 于是加一条新 git 命令永远不必改这个文件，而并发代码正是最难改对的地方。
 */
export class CommandQueue {
  /**
   * 写命令的队尾。
   *
   * 排队不需要真正的锁：把每个写命令**接在前一个的后面**，自然就串行了。
   * **它永远不会 reject**（见 `run()`）——否则一次失败会让整条链断掉，
   * 后面所有写命令跟着失败，而失败是常事（撞外部锁、钩子拒绝、冲突）。
   */
  private tail: Promise<void> = Promise.resolve();

  /**
   * 跑一条命令。写命令排队，读命令直接开始。
   *
   * 排队是**无限期的，没有超时**：超时了也没有更好的处置。
   * 这是安全的，因为没有任何网络命令占用写锁——`fetch`/`push` 都是
   * `LockPolicy.None`，写命令全是本地的（`locking.md` §2.2）。
   */
  async run<T>(lock: LockPolicy, action: () => Promise<T>): Promise<T> {
    switch (lock) {
      case LockPolicy.None:
        // 读命令不取任何锁，连队都不排。5 个并发的 log 会正确返回 5 次，
        // 那是浪费不是错误；「别跑太频繁」是 M6 节流要解决的问题。
        return action();

      case LockPolicy.Exclusive: {
        const previous = this.tail;
        const result = (async () => {
          // 等前一个写命令结束。成功失败都算结束——只关心「它不再占着 index」。
          await previous;
          return action();
        })();
        // 队尾换成这一个，但**剥掉它的失败**：链只用来排队，不用来传递结果。
        // 不剥的话，一次失败会连锁掐死后面所有写命令，还会产生未处理的 rejection。
        this.tail = result.then(
          () => undefined,
          () => undefined,
        );
        return result;
      }

      default:
        return assertNever(lock, "CommandQueue.run");
    }
  }
}
