import type * as vscode from "vscode";
import type { GitLogger } from "../git/types.js";

/**
 * 把 `git/` 的日志接到 VSCode 的输出面板。
 *
 * M2 把 `GitLogger` 定义成一个只有 `log(line)` 的接口，就是为了这一刻：
 * `git/` 层不 import `vscode`（lint 强制），所以它只能声明形状，
 * 由这一层接到真正的出口上。换个宿主（CLI、测试脚本）换一个实现即可。
 *
 * 调 git 出问题时，这个面板里那一行「跑了什么命令、多久、什么结局」
 * 往往是唯一有用的东西。
 */
export function createOutputLogger(channel: vscode.OutputChannel): GitLogger {
  return { log: (line) => channel.appendLine(line) };
}
