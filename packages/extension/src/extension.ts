import * as vscode from "vscode";
import { startAutoFetch } from "./core/autoFetch.js";
import { Repository } from "./core/repository.js";
import { GitCli } from "./git/cli.js";
import { fetchAll } from "./git/commands/index.js";
import { withAttached } from "./ipc/brief.js";
import { createHandlers, type HandlerUi } from "./ipc/handlers.js";
import { loggedUi } from "./ipc/loggedUi.js";
import { Operations, tagged } from "./ipc/operation.js";
import { Router, type Transport } from "./ipc/router.js";
import { Activity } from "./vscode/activity.js";
import { copyText } from "./vscode/clipboard.js";
import { choose, confirm, notifyChoice } from "./vscode/confirm.js";
import { DialogPanels } from "./vscode/dialogPanel.js";
import { openDiff } from "./vscode/diff.js";
import { ErrorGate } from "./vscode/errorGate.js";
import { resolveGitPath } from "./vscode/gitPath.js";
import { askBranchName } from "./vscode/input.js";
import {
  createLogChannel,
  createOutputLogger,
  logEnvironment,
  logRefresh,
  logRepository,
} from "./vscode/logger.js";
import { registerMenuCommands } from "./vscode/menu.js";
import { openMergeEditor } from "./vscode/mergeEditor.js";
import { describeStartup, discoverRepositories, StartupKind } from "./vscode/open.js";
import { openFile } from "./vscode/openFile.js";
import { pick } from "./vscode/pick.js";
import { notify, withProgress } from "./vscode/progress.js";
import { registerRevisionFileSystem } from "./vscode/revisionFileSystem.js";
import { StatusBar } from "./vscode/statusBar.js";
import { watchRepository } from "./vscode/watcher.js";
import { registerWebviewView, type ViewSource, ViewSourceKind } from "./vscode/webviewView.js";

/** 扩展入口。**只做装配**：把已经存在的各层接起来，不含任何业务逻辑。 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const channel = createLogChannel();
  context.subscriptions.push(channel);

  // git 路径、askpass 脚本路径与日志出口都从这里注入给 `GitCli`。
  const askpass = vscode.Uri.joinPath(context.extensionUri, "resources", "askpass-empty.sh").fsPath;
  // 操作（`ipc/operation.ts`）：webview 请求与右键菜单共用一个，编号不重。
  const operations = new Operations(channel);
  const gitPath = resolveGitPath();
  const cli = new GitCli(gitPath, createOutputLogger(channel), askpass);
  // 不等它：只是一行日志，不该拖慢视图注册。
  void logEnvironment(channel, context, cli, gitPath);

  // 未知错误的统一出口：输出面板写全，弹一条通知，
  // 点「Show Output」跳到输出面板。去重与文案在可在纯 node 下测的 errorGate.ts 里。
  const errors = new ErrorGate({
    // 在操作里报的带上编号（Router 与菜单在操作里交给关口）。
    error: (text) => channel.error(tagged(text)),
    warn: (text) => channel.warn(tagged(text)),
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
  // 正在做的操作：进度出口登记，状态栏转圈。状态栏要等仓库找到才有，先建好接住。
  const activity = new Activity();
  // handler 用到的界面动作。对话框的标签页要等仓库找到才有（`dialogs` 在下面），
  // 而 handler 只在有仓库之后才会被调到。
  // 套一层记录：问答与完成消息进日志（`ipc/loggedUi.ts`）。
  const ui: HandlerUi = loggedUi(
    {
      askBranchName,
      choose,
      confirm,
      copyText,
      logWebviewError: (message, stack) =>
        channel.error(tagged(withAttached(`webview 异常：${message}`, stack))),
      notify,
      notifyChoice,
      openDiff,
      openFile,
      openMergeEditor,
      pick,
      withProgress: (title, task, done) => withProgress(activity, title, task, done),
      openDialog: (dialog, subject, title) => dialogs?.open(dialog, subject, title),
      closeDialog: (dialog) => dialogs?.close(dialog),
    },
    channel,
  );
  let dialogs: DialogPanels | undefined;
  // 一次展开配一个 Router。收起再展开，握手会带来新代号，上一代的回复自动作废。
  const createRouter = (repository: Repository, transport: Transport, source: string): Router =>
    new Router(transport, createHandlers(repository, ui), {
      log: (line) => channel.info(line),
      operation: (command, params, task) => operations.run(source, command, params, task),
      report: (error) => errors.report(error),
    });
  // 状态栏的开关按 Log 视图此刻是否可见决定开还是关。
  let logVisible = false;
  context.subscriptions.push(
    registerWebviewView(context, "dummyGit.log", source, createRouter, (visible) => {
      logVisible = visible;
    }),
    registerWebviewView(context, "dummyGit.commit", source, createRouter),
  );

  // 与 VSCode 真正相关的只有「取出所有工作区目录」这一句，其余都在可在纯 node 下测的 open.ts 里。
  const directories = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);
  const startup = await discoverRepositories(cli, directories);

  // 没有仓库、git 不可用：视图里直接写原因，同时进输出面板，**不弹通知**。
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
  const stopLoggingRefresh = repository.onDidChange((domains) =>
    logRefresh(channel, domains, operations),
  );
  context.subscriptions.push({ dispose: stopLoggingRefresh });

  // 文件监听跟着**仓库**走，不跟视图走：外部改动要一直被感知到，
  // 哪怕此刻面板收着（下次展开时状态才是对的）。
  context.subscriptions.push(watchRepository(repository));

  // 自动 Fetch：和手动的 Fetch 一样记成一个操作。不带 `--prune`：
  // 远程上删掉的分支，本地的记录留到用户手动 Fetch 时再清，后台不替用户删东西。
  // 失败只记日志、不弹通知：用户没有点什么，不打扰。
  const autoFetch = startAutoFetch(
    () =>
      operations.run("自动", "fetchAll", { prune: false }, () =>
        repository.run(fetchAll, repository.location.root, { prune: false }),
      ),
    (cause) => errors.logOnly(cause),
  );
  context.subscriptions.push(autoFetch);

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

  // 状态栏：分支名 + 同步状态，有操作在跑时转圈，点击开关 Log 面板。
  context.subscriptions.push(new StatusBar(repository, activity, () => logVisible));

  settle({ kind: ViewSourceKind.Repository, repository });
}
