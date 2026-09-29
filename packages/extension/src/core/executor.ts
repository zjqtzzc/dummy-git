import type { GitCli } from "../git/cli.js";
import type { GitCommand } from "../git/commands/index.js";
import type { CommandQueue } from "./operation.js";

/**
 * 跑一条 git 命令的**唯一入口**。
 *
 * 它做的事只有一件：把命令自带的锁策略和命令的执行体一起交给队列。
 *
 * ## 为什么必须有这么一层
 *
 * 队列的接口是 `run(锁策略, 动作)`——两个参数各来各的，调用点理论上可以
 * 把 A 命令的锁策略配上 B 命令的执行体。那种错不会报错，只会偶发撞锁。
 *
 * 这个函数接收的是**整个 `GitCommand` 对象**，锁策略和执行体从声明时就绑在一起
 * （见 `git/commands/command.ts`），**配错在结构上不可能发生**。
 *
 * ## 为什么不放进 `operation.ts`
 *
 * 那会让队列 import `GitCli`——队列就开始认识 git 进程层了。
 * 队列的全部价值在于「加一条新 git 命令永不必改并发代码」，
 * 这一层是「组合」，不是「调度」，所以单独一个文件。
 *
 * M6 的 `Repository` 会把它包起来（还要加上「跑完要不要刷新状态」），
 * 那时这里就是它的内核。
 */
export function runCommand<A extends readonly unknown[], R>(
  queue: CommandQueue,
  cli: GitCli,
  command: GitCommand<A, R>,
  ...args: A
): Promise<R> {
  return queue.run(command.lock, () => command.execute(cli, ...args));
}
