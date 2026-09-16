/**
 * git 命令日志的出口。注入式——`git/` 层不许 import `vscode`，
 * 所以这里只定义形状，由 `vscode/` 层接到 OutputChannel 上。
 */
export interface GitLogger {
  readonly log: (line: string) => void;
}

/** 什么都不做的 logger。让 `GitCli` 内部可以无条件调用，不必到处判空。 */
export const NOOP_LOGGER: GitLogger = { log: () => {} };

/** 命令被 `AbortSignal` 取消。用类而非 `err.name === "AbortError"`，避免字符串匹配。 */
export class GitCancelledError extends Error {
  constructor(args: readonly string[]) {
    super(`git 命令被取消：${args.join(" ")}`);
    this.name = "GitCancelledError";
  }
}

/** git 进程层的类型。只描述形状，不 import 任何东西。设计理由见 `.notes/design/M2-git-cli.md`。 */

/** 一条 git 命令的结果，stdout 已解码成 UTF-8 文本。 */
export interface ExecResult {
  /** 退出码是数据不是异常：`diff --quiet` 返回 1 表示「有差异」，不是失败。 */
  readonly exitCode: number;
  readonly stdout: string;
  /** exitCode 为 0 时也可能非空——git 的 warning 走 stderr。 */
  readonly stderr: string;
}

/** `execRaw()` 的结果。stdout 保持原始字节，解码由上层按需进行。 */
export interface RawExecResult {
  readonly exitCode: number;
  readonly stdout: Buffer;
  readonly stderr: string;
}

/**
 * 子进程的最终结局。三种互斥情况，用 tagged union 表达，避免出现
 * 「exitCode 是 null 还是数字」这类需要调用方自己判断的半成品状态。
 *
 * 放在 `git/` 而不是 `shared/`：它从不跨 extension ↔ webview 边界，
 * 上提会让 `shared` 变成杂物间。
 */
export enum StreamEndKind {
  /** 进程正常结束，有退出码。 */
  Exited = "exited",
  /** 被信号终止——通常是消费方提前 break，我们主动 kill 的。 */
  Killed = "killed",
  /** 进程根本没起来：git 不存在、cwd 不存在、无执行权限。 */
  Failed = "failed",
  /** 调用时 signal 已经 abort，进程压根没起。 */
  Cancelled = "cancelled",
}

export type StreamEnd =
  | { readonly kind: StreamEndKind.Exited; readonly exitCode: number; readonly stderr: string }
  | { readonly kind: StreamEndKind.Killed; readonly signal: string; readonly stderr: string }
  | { readonly kind: StreamEndKind.Failed; readonly error: Error }
  | { readonly kind: StreamEndKind.Cancelled };

/**
 * `stream()` 的结果：消费回调的返回值 + 子进程的结局。
 *
 * ```ts
 * const { value, end } = await git.stream(["status", "-z"], { cwd }, async (chunks) => {
 *   let n = 0;
 *   for await (const chunk of chunks) {
 *     n += chunk.length;
 *     if (n > LIMIT) break;      // break 即可，进程由 stream() 负责清理
 *   }
 *   return n;
 * });
 * ```
 *
 * 回调返回（或抛出）时子进程一定被清理，不存在「忘记消费导致进程泄漏」这种用法。
 */
export interface StreamResult<T> {
  /** 消费回调的返回值。 */
  readonly value: T;
  /** 子进程的结局。回调抛出时整个 `stream()` 抛出，拿不到这个值。 */
  readonly end: StreamEnd;
}
