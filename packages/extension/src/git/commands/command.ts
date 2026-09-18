import type { GitCli } from "../cli.js";
import type { LockPolicy } from "./lock.js";

/**
 * 一条 git 命令的形状：**锁策略 + 怎么执行**，绑在一起。
 *
 * 这是「命令自带锁策略」的落实手段——`lock` 是必填字段，
 * **声明一条命令时不可能忘记标注它**。
 *
 * 对比被否决的做法（调用时传锁策略）：那样每个调用点都可能写错，
 * 把 commit 标成不上锁不会报任何错，只会偶发地撞 `.git/index.lock`，
 * 而那种 bug 几乎无法复现。
 *
 * 类型参数：
 * - `A` —— 这条命令除 `cli` 外还要什么参数（如仓库路径、提交消息）
 * - `R` —— 它返回什么（领域对象，如 `Commit[]`；或一个字符串）
 */
export interface GitCommand<A extends readonly unknown[], R> {
  readonly lock: LockPolicy;
  readonly execute: (cli: GitCli, ...args: A) => Promise<R>;
}
