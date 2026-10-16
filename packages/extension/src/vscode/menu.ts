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
 * 不经过 Router。所以每个菜单命令只做薄薄一层：
 * 1. 从 context 取出某条协议命令的参数，用 Router 入口**同一张**参数校验表校验（webview 来的数据，是边界）；
 * 2. 调**同一个** handler；
 * 3. 出错交给**同一个**错误关口（这就是 ARCHITECTURE 第 15 题的「命令注册包装」）。
 * 执行逻辑、校验、错误出口都只有一份。结果不回给页面：界面靠 watcher 刷新。
 */
interface MenuCommand {
  /** VS Code 命令 id，与 `package.json` 一致。 */
  readonly id: string;
  readonly run: (handlers: HandlerMap, operations: Operations, context: unknown) => Promise<void>;
}

function menuCommand<K extends CommandName>(
  id: string,
  command: K,
  /** 从 context 取出协议参数（还没校验）。 */
  params: (context: Record<string, unknown>) => Record<string, unknown>,
): MenuCommand {
  return {
    id,
    run: async (handlers, operations, context) => {
      const parsed = isRecord(context) ? parseParams(command, params(context)) : undefined;
      if (parsed === undefined) throw new Error(`Rejected menu command ${id}: invalid context`);
      // 来源记菜单命令 id：一看就知道是右键菜单里的哪一项。
      await operations.run(id, command, parsed, () => handlers[command](parsed));
    },
  };
}

/** Commit 面板一个文件的菜单项：仓库与路径。 */
function fileParams(context: Record<string, unknown>): Record<string, unknown> {
  return { repo: context[MenuContextKey.Repo], path: context[MenuContextKey.Path] };
}

/** stash 那一行的菜单项：仓库与 stash 的 hash。 */
function stashParams(context: Record<string, unknown>): Record<string, unknown> {
  return { repo: context[MenuContextKey.Repo], hash: context[MenuContextKey.Stash] };
}

/** 提交列表的一行：仓库与完整 hash。 */
function commitParams(context: Record<string, unknown>): Record<string, unknown> {
  return { repo: context[MenuContextKey.Repo], hash: context[MenuContextKey.Hash] };
}

/** 把当前分支变基到这一行提交上。显示名用 7 位，和别处的短 hash 一样长。 */
function rebaseHereParams(context: Record<string, unknown>): Record<string, unknown> {
  const hash = context[MenuContextKey.Hash];
  return {
    repo: context[MenuContextKey.Repo],
    start: hash,
    startName: typeof hash === "string" ? hash.slice(0, 7) : "",
  };
}

/** 合并、变基：仓库、完整引用、显示名。本地分支和远程分支的上下文里都有。 */
function refParams(context: Record<string, unknown>): Record<string, unknown> {
  return {
    repo: context[MenuContextKey.Repo],
    start: context[MenuContextKey.Start],
    startName: context[MenuContextKey.StartName],
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
  menuCommand("dummyGit.updateBranch", "update", (context) => ({
    repo: context[MenuContextKey.Repo],
    branch: context[MenuContextKey.Branch],
  })),
  menuCommand("dummyGit.pushBranch", "openPushDialog", (context) => ({
    repo: context[MenuContextKey.Repo],
    branch: context[MenuContextKey.Branch],
  })),
  menuCommand("dummyGit.mergeBranch", "merge", refParams),
  menuCommand("dummyGit.rebaseBranch", "rebase", refParams),
  menuCommand("dummyGit.newBranch", "newBranch", (context) => ({
    repo: context[MenuContextKey.Repo],
    start: context[MenuContextKey.Start],
    startName: context[MenuContextKey.StartName],
  })),
  menuCommand("dummyGit.renameBranch", "renameBranch", (context) => ({
    repo: context[MenuContextKey.Repo],
    branch: context[MenuContextKey.Branch],
  })),
  menuCommand("dummyGit.deleteBranch", "deleteBranch", (context) => ({
    repo: context[MenuContextKey.Repo],
    branch: context[MenuContextKey.Branch],
  })),
  menuCommand("dummyGit.deleteRemoteBranch", "deleteRemoteBranch", (context) => ({
    repo: context[MenuContextKey.Repo],
    remote: context[MenuContextKey.Remote],
    branch: context[MenuContextKey.Branch],
  })),
  menuCommand("dummyGit.copyHash", "copyText", (context) => ({
    text: context[MenuContextKey.Hash],
  })),
  menuCommand("dummyGit.resetTo", "resetTo", commitParams),
  menuCommand("dummyGit.rewordCommit", "openRewordDialog", commitParams),
  menuCommand("dummyGit.cherryPick", "cherryPick", commitParams),
  menuCommand("dummyGit.revertCommit", "revert", commitParams),
  menuCommand("dummyGit.rebaseHere", "rebase", rebaseHereParams),
  menuCommand("dummyGit.openMergeEditor", "openMergeEditor", fileParams),
  menuCommand("dummyGit.markResolved", "markResolved", fileParams),
  // Keep 就是标记已解决：留下工作区里的那份（一边删了的冲突，文件里本来没有冲突标记）。
  menuCommand("dummyGit.keepFile", "markResolved", fileParams),
  menuCommand("dummyGit.removeConflictFile", "removeConflictFile", fileParams),
  menuCommand("dummyGit.rollbackFile", "rollback", (context) => ({
    repo: context[MenuContextKey.Repo],
    paths: [context[MenuContextKey.Path]],
  })),
  menuCommand("dummyGit.addUntracked", "addUntracked", fileParams),
  menuCommand("dummyGit.deleteUntracked", "deleteUntracked", fileParams),
  menuCommand("dummyGit.popStash", "popStash", stashParams),
  menuCommand("dummyGit.applyStash", "applyStash", stashParams),
  menuCommand("dummyGit.dropStash", "dropStash", stashParams),
];

export function registerMenuCommands(
  handlers: HandlerMap,
  operations: Operations,
  errors: ErrorGate,
): vscode.Disposable {
  return vscode.Disposable.from(
    ...MENU_COMMANDS.map(({ id, run }) =>
      vscode.commands.registerCommand(id, (context: unknown) =>
        run(handlers, operations, context).catch((error: unknown) => errors.report(error)),
      ),
    ),
  );
}
