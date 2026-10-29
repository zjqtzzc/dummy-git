import { GitDomain } from "@dummy-git/shared";
import * as vscode from "vscode";
import type { Repository } from "../core/repository.js";
import { getHead, getRefs } from "../git/commands/index.js";
import { branchStatus } from "./branchStatus.js";

const TOGGLE_LOG = "dummyGit.toggleLogPanel";

/**
 * 状态栏右侧：当前分支及同步状态（`branchStatus.ts`），点一下开 Log 面板，再点一下关。
 *
 * 开还是关看 Log 视图此刻是否可见（`logVisible`），不自己记「上次点了什么」：
 * 用户手动关掉面板、切到别的面板标签时，自己记的那份就错了。
 */
export class StatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  private readonly disposables: vscode.Disposable[] = [this.item];

  constructor(
    private readonly repository: Repository,
    private readonly logVisible: () => boolean,
  ) {
    this.item.command = TOGGLE_LOG;
    this.item.tooltip = "Show / hide the Dummy Git log";
    this.disposables.push(vscode.commands.registerCommand(TOGGLE_LOG, () => this.toggleLog()));
    const unsubscribe = repository.onDidChange((domains) => {
      if (domains.has(GitDomain.Refs) || domains.has(GitDomain.Operation)) void this.update();
    });
    this.disposables.push({ dispose: unsubscribe });
    void this.update();
  }

  private async toggleLog(): Promise<void> {
    // `<视图 id>.focus` 是 VS Code 按 package.json 的 contributes.views 自动生成的命令。
    await vscode.commands.executeCommand(
      this.logVisible() ? "workbench.action.closePanel" : "dummyGit.log.focus",
    );
  }

  private async update(): Promise<void> {
    const root = this.repository.location.root;
    try {
      const [head, refs] = await Promise.all([
        this.repository.run(getHead, root),
        this.repository.run(getRefs, root),
      ]);
      const text = branchStatus([head, ...refs]);
      if (text === undefined) {
        this.item.hide();
        return;
      }
      this.item.text = text;
      this.item.show();
    } catch {
      // 仓库可能已失效：保留上一次的显示。
    }
  }

  dispose(): void {
    for (const disposable of this.disposables) disposable.dispose();
  }
}
