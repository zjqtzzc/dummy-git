import { type CommandName, MenuContextKey } from "@dummy-git/shared";
import * as vscode from "vscode";
import { isRecord, parseParams } from "../ipc/protocol.guards.js";
import type { HandlerMap } from "../ipc/router.js";
import type { ErrorGate } from "./errorGate.js";

/**
 * 原生右键菜单（`package.json` 的 `webview/context`）：协议的第二个入口，不是第二套流程。
 *
 * 菜单项被点时，VS Code 直接调这里注册的命令，参数是页面元素上 `data-vscode-context` 的整份 JSON，
 * 不经过 Router。所以每个菜单命令只做薄薄一层：
 * 1. 从 context 取出某条协议命令的参数，用 Router 入口**同一张**参数校验表校验（webview 来的数据，是边界）；
 * 2. 调**同一个** handler；
 * 3. 出错交给**同一个**错误关口（这就是 ARCHITECTURE 第 15 题的「命令注册包装」）。
 * 执行逻辑、校验、错误出口都只有一份。结果不回给页面：界面靠 watcher 刷新。
 */
interface MenuCommand {
  /** VS Code 命令 id，与 `package.json` 一致。 */
  readonly id: string;
  readonly run: (handlers: HandlerMap, context: unknown) => Promise<void>;
}

function menuCommand<K extends CommandName>(
  id: string,
  command: K,
  /** 从 context 取出协议参数（还没校验）。 */
  params: (context: Record<string, unknown>) => Record<string, unknown>,
): MenuCommand {
  return {
    id,
    run: async (handlers, context) => {
      const parsed = isRecord(context) ? parseParams(command, params(context)) : undefined;
      if (parsed === undefined) throw new Error(`Rejected menu command ${id}: invalid context`);
      await handlers[command](parsed);
    },
  };
}

const MENU_COMMANDS: readonly MenuCommand[] = [
  menuCommand("dummyGit.checkout", "checkout", (context) => ({
    repo: context[MenuContextKey.Repo],
    branch: context[MenuContextKey.Branch],
  })),
  menuCommand("dummyGit.checkoutRemote", "checkoutRemote", (context) => ({
    repo: context[MenuContextKey.Repo],
    remote: context[MenuContextKey.Remote],
    branch: context[MenuContextKey.Branch],
  })),
  menuCommand("dummyGit.newBranch", "newBranch", (context) => ({
    repo: context[MenuContextKey.Repo],
    start: context[MenuContextKey.Start],
    startName: context[MenuContextKey.StartName],
  })),
];

export function registerMenuCommands(handlers: HandlerMap, errors: ErrorGate): vscode.Disposable {
  return vscode.Disposable.from(
    ...MENU_COMMANDS.map(({ id, run }) =>
      vscode.commands.registerCommand(id, (context: unknown) =>
        run(handlers, context).catch((error: unknown) => errors.report(error)),
      ),
    ),
  );
}
