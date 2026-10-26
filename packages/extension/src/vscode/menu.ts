import { type CommandName, MenuContextKey } from "@dummy-git/shared";
import * as vscode from "vscode";
import type { Operations } from "../ipc/operation.js";
import { isRecord, parseParams } from "../ipc/protocol.guards.js";
import type { HandlerMap } from "../ipc/router.js";
import type { ErrorGate } from "./errorGate.js";

/**
 * 原生右键菜单（`package.json` 的 `webview/context`）：协议的第二个入口，不是第二套流程。
 *
 * 菜单项被点时，VS Code 直接调这里注册的命令，参数是页面元素上 `data-vscode-context` 的整份 JSON，
 * 不经过 Router。页面已经按选中算好了每一项的参数，放在以命令 id 为键的那一格里（`shared/src/menu.ts`），
 * 所以每个菜单命令只做薄薄一层，而且都一样：
 * 1. 取出自己那一格、补上 `repo`，用 Router 入口**同一张**参数校验表校验；
 * 2. 调**同一个** handler；
 * 3. 出错交给**同一个**错误关口。
 * 能不能做、对谁做，这里不再判断一遍。执行逻辑、校验、错误出口都只有一份。结果不回给页面：界面靠 watcher 刷新。
 */
interface MenuCommand {
  /** VS Code 命令 id，与 `package.json` 一致。 */
  readonly id: string;
  readonly run: (
    handlers: HandlerMap,
    operations: Operations,
    errors: ErrorGate,
    context: unknown,
  ) => Promise<void>;
}

/** 菜单项 `id` 调协议命令 `command`。 */
function menuCommand<K extends CommandName>(id: string, command: K): MenuCommand {
  return {
    id,
    run: async (handlers, operations, errors, context) => {
      const args = isRecord(context) ? context[id] : undefined;
      const parsed =
        isRecord(context) && isRecord(args)
          ? parseParams(command, { ...args, repo: context[MenuContextKey.Repo] })
          : undefined;
      if (parsed === undefined) throw new Error(`Rejected menu command ${id}: invalid context`);
      // 来源记菜单命令 id：一看就知道是右键菜单里的哪一项。
      // 在操作里交给错误关口，详情那行带上操作编号；外面不再报。
      await operations
        .run(id, command, parsed, async () => {
          try {
            return await handlers[command](parsed);
          } catch (error) {
            errors.report(error);
            throw error;
          }
        })
        .catch(() => {});
    },
  };
}

const MENU_COMMANDS: readonly MenuCommand[] = [
  menuCommand(MenuContextKey.Checkout, "checkout"),
  menuCommand(MenuContextKey.CheckoutRemote, "checkoutRemote"),
  menuCommand(MenuContextKey.UpdateBranch, "update"),
  menuCommand(MenuContextKey.PushBranch, "openPushDialog"),
  menuCommand(MenuContextKey.MergeBranch, "merge"),
  menuCommand(MenuContextKey.RebaseBranch, "rebase"),
  menuCommand(MenuContextKey.NewBranch, "newBranch"),
  menuCommand(MenuContextKey.RenameBranch, "renameBranch"),
  menuCommand(MenuContextKey.DeleteBranches, "deleteBranches"),
  menuCommand(MenuContextKey.CopyHash, "copyText"),
  menuCommand(MenuContextKey.ResetTo, "resetTo"),
  menuCommand(MenuContextKey.Reword, "openRewordDialog"),
  menuCommand(MenuContextKey.CherryPick, "cherryPick"),
  menuCommand(MenuContextKey.Revert, "revert"),
  menuCommand(MenuContextKey.RebaseHere, "rebase"),
  menuCommand(MenuContextKey.OpenFile, "openFile"),
  menuCommand(MenuContextKey.OpenMergeEditor, "openMergeEditor"),
  menuCommand(MenuContextKey.MarkResolved, "markResolved"),
  // Keep 就是标记已解决：留下工作区里的那份（一边删了的冲突，文件里本来没有冲突标记）。
  menuCommand(MenuContextKey.KeepFile, "markResolved"),
  menuCommand(MenuContextKey.RemoveConflictFile, "removeConflictFile"),
  menuCommand(MenuContextKey.RollbackFile, "rollback"),
  menuCommand(MenuContextKey.AddUntracked, "addUntracked"),
  menuCommand(MenuContextKey.DeleteUntracked, "deleteUntracked"),
  menuCommand(MenuContextKey.PopStash, "popStash"),
  menuCommand(MenuContextKey.ApplyStash, "applyStash"),
  menuCommand(MenuContextKey.DropStash, "dropStash"),
];

export function registerMenuCommands(
  handlers: HandlerMap,
  operations: Operations,
  errors: ErrorGate,
): vscode.Disposable {
  return vscode.Disposable.from(
    ...MENU_COMMANDS.map(({ id, run }) =>
      vscode.commands.registerCommand(id, (context: unknown) =>
        // 这里接住的只剩 context 不合法：handler 的错误已在操作里交给关口。
        run(handlers, operations, errors, context).catch((error: unknown) => errors.report(error)),
      ),
    ),
  );
}
