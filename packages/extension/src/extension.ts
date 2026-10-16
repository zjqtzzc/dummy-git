import * as vscode from "vscode";
import { Repository } from "./core/repository.js";
import { GitCli } from "./git/cli.js";
import { createHandlers, type HandlerUi } from "./ipc/handlers.js";
import { Operations } from "./ipc/operation.js";
import { Router, type Transport } from "./ipc/router.js";
import { copyText } from "./vscode/clipboard.js";
import { choose, confirm, confirmRollback, notifyChoice } from "./vscode/confirm.js";
import { DialogPanels } from "./vscode/dialogPanel.js";
import { openDiff } from "./vscode/diff.js";
import { ErrorGate } from "./vscode/errorGate.js";
import { resolveGitPath } from "./vscode/gitPath.js";
import { askBranchName } from "./vscode/input.js";
import {
  createLogChannel,
  createOutputLogger,
  logEnvironment,
  logRepository,
} from "./vscode/logger.js";
import { registerMenuCommands } from "./vscode/menu.js";
import { openMergeEditor } from "./vscode/mergeEditor.js";
import { describeStartup, discoverRepositories, StartupKind } from "./vscode/open.js";
import { pick } from "./vscode/pick.js";
import { notify, withProgress } from "./vscode/progress.js";
import { registerRevisionFileSystem } from "./vscode/revisionFileSystem.js";
import { watchRepository } from "./vscode/watcher.js";
import { registerWebviewView, type ViewSource, ViewSourceKind } from "./vscode/webviewView.js";

/** 扩展入口。**只做装配**：把已经存在的各层接起来，不含任何业务逻辑。 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const channel = createLogChannel();
  context.subscriptions.push(channel);

  // git/ 层不 import vscode（lint 强制），所以 git 路径、askpass 脚本路径与日志出口都从这里注入。
  const askpass = vscode.Uri.joinPath(context.extensionUri, "resources", "askpass-empty.sh").fsPath;
  // 操作（`ipc/operation.ts`）：webview 请求与右键菜单共用一个，编号不重。
  const operations = new Operations(channel);
  const gitPath = resolveGitPath();
  const cli = new GitCli(gitPath, createOutputLogger(channel), askpass);
  // 不等它：只是一行日志，不该拖慢视图注册。
  void logEnvironment(channel, context, cli, gitPath);

  // 未知错误的统一出口（`ARCHITECTURE.md` 第 15 题）：输出面板写全，弹一条通知，
  // 点「Show Output」跳到输出面板。去重与文案在可在纯 node 下测的 errorGate.ts 里。
  const errors = new ErrorGate({
    log: (text) => channel.error(text),
    show: async (summary) => {
      const pick = await vscode.window.showErrorMessage(`Dummy Git: ${summary}`, "Show Output");
      if (pick !== undefined) channel.show();
    },
  });

  // 视图先注册、内容后定：面板上次开着的话，视图可能在仓库还没找完时就要显示，
  // 它拿着这个 Promise 等启动结果（`vscode/webviewView.ts`）。
  let settle: (source: ViewSource) => void = () => {};
  const source = new Promise<ViewSource>((resolve) => {
    settle = resolve;
  });
  // handler 用到的界面动作。对话框的标签页要等仓库找到才有（`dialogs` 在下面），
  // 而 handler 只在有仓库之后才会被调到。
  const ui: HandlerUi = {
    askBranchName,
    choose,
    confirm,
    confirmRollback,
    copyText,
    notify,
    notifyChoice,
    openDiff,
    openMergeEditor,
    pick,
    withProgress,
    openDialog: (dialog, subject, title) => dialogs?.open(dialog, subject, title),
    closeDialog: (dialog) => dialogs?.close(dialog),
  };
  let dialogs: DialogPanels | undefined;
  // 一次展开配一个 Router。收起再展开，握手会带来新代号，上一代的回复自动作废。
  const createRouter = (repository: Repository, transport: Transport, source: string): Router =>
    new Router(transport, createHandlers(repository, ui), {
      log: (line) => channel.debug(line),
      operation: (command, params, task) => operations.run(source, command, params, task),
      report: (error) => errors.report(error),
    });
  for (const viewType of ["dummyGit.log", "dummyGit.commit"]) {
    context.subscriptions.push(registerWebviewView(context, viewType, source, createRouter));
  }

  // 与 VSCode 真正相关的只有「取出所有工作区目录」这一句，其余都在可在纯 node 下测的 open.ts 里。
  const directories = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);
  const startup = await discoverRepositories(cli, directories);

  // 没有仓库、git 不可用：视图里直接写原因，同时进输出面板，**不弹通知**（`ARCHITECTURE.md` 第 13 题）。
  const reason = describeStartup(startup);
  if (reason !== undefined) {
    channel.info(reason);
    settle({ kind: ViewSourceKind.Unavailable, reason });
  }
  if (startup.kind !== StartupKind.Ready) return;

  // 现阶段只支持单仓库：用列表第一个。
  const repository = new Repository(startup.repositories[0], cli);
  context.subscriptions.push({ dispose: () => repository.dispose() });
  logRepository(channel, repository.location);

  // 文件监听跟着**仓库**走，不跟视图走：外部改动要一直被感知到，
  // 哪怕此刻面板收着（下次展开时状态才是对的）。
  context.subscriptions.push(watchRepository(repository));

  // 原生右键菜单：协议的第二个入口，用同一套 handler（`vscode/menu.ts`）。
  context.subscriptions.push(
    registerMenuCommands(createHandlers(repository, ui), operations, errors),
  );

  // 推送等对话框：开在编辑器标签页里（`vscode/dialogPanel.ts`），和面板用同一套 handler。
  dialogs = new DialogPanels(context.extensionUri, (transport, source) =>
    createRouter(repository, transport, source),
  );

  // diff 里历史版本的内容。重新加载窗口后恢复的 diff 标签也靠它（`onFileSystem:dummygit` 激活）。
  context.subscriptions.push(registerRevisionFileSystem(repository, errors));

  settle({ kind: ViewSourceKind.Repository, repository });
}
