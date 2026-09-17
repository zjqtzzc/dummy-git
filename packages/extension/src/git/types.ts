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
