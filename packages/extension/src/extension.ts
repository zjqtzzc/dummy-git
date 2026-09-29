import * as vscode from "vscode";
import { Repository } from "./core/repository.js";
import { GitCli } from "./git/cli.js";
import { createHandlers } from "./ipc/handlers.js";
import { Router } from "./ipc/router.js";
import { openDiff } from "./vscode/diff.js";
import { ErrorGate } from "./vscode/errorGate.js";
import { resolveGitPath } from "./vscode/gitPath.js";
import { createOutputLogger } from "./vscode/logger.js";
import { type LogSource, LogSourceKind, registerLogView } from "./vscode/logView.js";
import { describeStartup, discoverRepositories, StartupKind } from "./vscode/open.js";
import { registerRevisionFileSystem } from "./vscode/revisionFileSystem.js";
import { watchRepository } from "./vscode/watcher.js";

/** 扩展入口。**只做装配**：把已经存在的各层接起来，不含任何业务逻辑。 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const channel = vscode.window.createOutputChannel("Dummy Git");
  context.subscriptions.push(channel);

  // git/ 层不 import vscode（lint 强制），所以路径与日志出口都从这里注入。
  const cli = new GitCli(resolveGitPath(), createOutputLogger(channel));

  // 未知错误的统一出口（`ARCHITECTURE.md` 第 15 题）：输出面板写全，弹一条通知，
  // 点「Show Output」跳到输出面板。去重与文案在可在纯 node 下测的 errorGate.ts 里。
  const errors = new ErrorGate({
    log: (text) => channel.appendLine(text),
    show: async (summary) => {
      const pick = await vscode.window.showErrorMessage(`Dummy Git: ${summary}`, "Show Output");
      if (pick !== undefined) channel.show();
    },
  });

  // 视图先注册、内容后定：面板上次开着的话，视图可能在仓库还没找完时就要显示，
  // 它拿着这个 Promise 等启动结果（`vscode/logView.ts`）。
  let settle: (source: LogSource) => void = () => {};
  const source = new Promise<LogSource>((resolve) => {
    settle = resolve;
  });
  context.subscriptions.push(
    registerLogView(
      context,
      source,
      // 一次展开配一个 Router。收起再展开，握手会带来新代号，上一代的回复自动作废。
      (repository, transport) =>
        new Router(transport, createHandlers(repository, { openDiff }), {
          log: (line) => channel.appendLine(line),
          report: (error) => errors.report(error),
        }),
    ),
  );

  // 与 VSCode 真正相关的只有「取出所有工作区目录」这一句，其余都在可在纯 node 下测的 open.ts 里。
  const directories = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);
  const startup = await discoverRepositories(cli, directories);

  // 没有仓库、git 不可用：视图里直接写原因，同时进输出面板，**不弹通知**（`ARCHITECTURE.md` 第 13 题）。
  const reason = describeStartup(startup);
  if (reason !== undefined) {
    channel.appendLine(reason);
    settle({ kind: LogSourceKind.Unavailable, reason });
  }
  if (startup.kind !== StartupKind.Ready) return;

  // 现阶段只支持单仓库：用列表第一个。
  const repository = new Repository(startup.repositories[0], cli);
  context.subscriptions.push({ dispose: () => repository.dispose() });
  channel.appendLine(`Repository: ${repository.location.root}`);

  // 文件监听跟着**仓库**走，不跟视图走：外部改动要一直被感知到，
  // 哪怕此刻面板收着（下次展开时状态才是对的）。
  context.subscriptions.push(watchRepository(repository));

  // diff 里历史版本的内容。重新加载窗口后恢复的 diff 标签也靠它（`onFileSystem:dummygit` 激活）。
  context.subscriptions.push(registerRevisionFileSystem(repository, errors));

  settle({ kind: LogSourceKind.Repository, repository });
}

export function deactivate(): void {
  // 需要清理的东西都进了 context.subscriptions，由宿主负责。
}
