import * as vscode from "vscode";
import type { Repository } from "./core/repository.js";
import { GitCli } from "./git/cli.js";
import { createHandlers } from "./ipc/handlers.js";
import { Router } from "./ipc/router.js";
import { resolveGitPath } from "./vscode/gitPath.js";
import { createOutputLogger } from "./vscode/logger.js";
import { isNotARepository, openRepository } from "./vscode/open.js";
import { openLogPanel } from "./vscode/panel.js";
import { watchRepository } from "./vscode/watcher.js";

/**
 * 扩展入口。**只做装配**：把已经存在的各层接起来，不含任何业务逻辑。
 *
 * 目标是 `extension.ts < 150 行`（`ARCHITECTURE-NOTES.md` §6）。
 * 旧仓库这个文件 1720 行、塞了 89 个 handler——那是「上帝文件」的教科书形态，
 * 也是协议漂移能发生的土壤。
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const channel = vscode.window.createOutputChannel("Dummy Git");
  context.subscriptions.push(channel);

  // git/ 层不 import vscode（lint 强制），所以路径与日志出口都从这里注入。
  const cli = new GitCli(resolveGitPath(), createOutputLogger(channel));

  /**
   * 没能打开仓库时的原因。
   *
   * **第一版曾把命令注册放在「仓库打开成功」之后**，结果是：扩展宿主窗口没开文件夹时，
   * 命令根本没注册，命令面板里搜不到任何东西——**扩展看起来完全不存在，
   * 而且没有任何途径知道为什么**。原因确实写在输出面板里，但得先知道去看那儿。
   *
   * 所以改成：命令**无条件注册**，跑不了的时候由它自己说清楚为什么。
   * 「功能不可用」和「功能不存在」对用户是完全不同的两件事。
   */
  let repository: Repository | undefined;
  let unavailable = "正在启动…";

  context.subscriptions.push(
    vscode.commands.registerCommand("dummyGit.showLog", () => {
      if (repository === undefined) {
        void vscode.window.showWarningMessage(`Dummy Git：${unavailable}`);
        return;
      }
      const repo = repository;
      // 一个面板配一个 Router。面板关了再开，握手会带来新代号，
      // 上一代的回复自动作废（`ipc/router.ts` 的换代逻辑）。
      openLogPanel(
        context,
        (transport) =>
          new Router(transport, createHandlers(repo), {
            log: (line) => channel.appendLine(line),
          }),
        // 仓库变了 → 广播给这个面板。只说「哪些域过期了」，不带数据：
        // 要不要重新拉由前端自己决定（`DECISIONS.md`「数据流向的总原则」）。
        (router) =>
          repo.onDidChange((domains) => router.broadcast(repo.location.root, [...domains])),
      );
    }),
  );

  // 状态栏入口。**没有它这个扩展在界面上完全不可见**——只有一条命令，
  // 不按 Cmd+Shift+P 搜就永远找不到。「功能不可用」和「功能找不到」
  // 对用户是一样的结果，而后者更让人以为是装错了。
  //
  // 活动栏图标 + 常驻视图是更好的形态（旧仓库就是那样），但那要把面板从
  // `WebviewPanel` 改成 `WebviewViewProvider`，属垂直切片期。状态栏是现在
  // 花五行就能消除「找不到」的做法。
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.text = "$(git-commit) Dummy Git";
  status.tooltip = "打开 Dummy Git 日志面板";
  status.command = "dummyGit.showLog";
  status.show();
  context.subscriptions.push(status);

  // 第一版：只认第一个 workspace folder。这是与 VSCode 真正相关的**全部**逻辑，
  // 其余都在可在纯 node 下测的 open.ts 里。
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder === undefined) {
    unavailable = "当前窗口没有打开文件夹。打开一个 git 仓库所在的文件夹后重开窗口。";
    channel.appendLine(unavailable);
    return;
  }

  try {
    repository = await openRepository(cli, folder.uri.fsPath);
    context.subscriptions.push({ dispose: () => repository?.dispose() });
    channel.appendLine(`仓库：${repository.location.root}`);

    // 文件监听跟着**仓库**走，不跟面板走：外部改动要一直被感知到，
    // 哪怕此刻一个面板都没开（下次开面板时状态才是对的）。
    context.subscriptions.push(watchRepository(repository));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (isNotARepository(error)) {
      // 用户在非仓库目录里打开编辑器是**正常情况**，不弹错误。
      unavailable = `${folder.uri.fsPath} 不是 git 仓库。`;
      channel.appendLine(unavailable);
      return;
    }
    // 其他失败要让人看见：git 不存在、没有执行权限、仓库损坏……
    unavailable = `启动失败：${detail}`;
    channel.appendLine(unavailable);
    void vscode.window.showErrorMessage(
      `Dummy Git 启动失败，详情见输出面板「Dummy Git」：${detail}`,
    );
  }
}

export function deactivate(): void {
  // 需要清理的东西都进了 context.subscriptions，由宿主负责。
}
