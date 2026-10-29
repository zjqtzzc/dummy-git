import { GitDomain, type Ref } from "@dummy-git/shared";
import * as vscode from "vscode";
import type { Repository } from "../core/repository.js";
import { getHead, getRefs } from "../git/commands/index.js";
import type { Activity } from "./activity.js";
import { branchStatus } from "./branchStatus.js";

const TOGGLE_LOG = "dummyGit.toggleLogPanel";
const TOGGLE_HINT = "Show / hide the Dummy Git log";

/**
 * 状态栏右侧：当前分支及同步状态（`branchStatus.ts`），点一下开 Log 面板，再点一下关。
 * 有操作在跑（`activity`）时图标转圈，悬停列出在做什么。
 *
 * 开还是关看 Log 视图此刻是否可见（`logVisible`），不自己记「上次点了什么」：
 * 用户手动关掉面板、切到别的面板标签时，自己记的那份就错了。
 */
export class StatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  private readonly disposables: vscode.Disposable[] = [this.item];
  /** 上一次取到的 HEAD 与引用。操作开始、结束只换图标，不必重跑 git。 */
  private refs: readonly Ref[] = [];

  constructor(
    private readonly repository: Repository,
    private readonly activity: Activity,
    private readonly logVisible: () => boolean,
  ) {
    this.item.command = TOGGLE_LOG;
    this.disposables.push(vscode.commands.registerCommand(TOGGLE_LOG, () => this.toggleLog()));
    const stopRefs = repository.onDidChange((domains) => {
      if (domains.has(GitDomain.Refs)) void this.update();
    });
    const stopActivity = activity.onDidChange(() => this.render());
    this.disposables.push({ dispose: stopRefs }, { dispose: stopActivity });
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
      this.refs = [head, ...refs];
      this.render();
    } catch {
      // 仓库可能已失效：保留上一次的显示。
    }
  }

  private render(): void {
    const { titles } = this.activity;
    const text = branchStatus(this.refs, titles.length > 0);
    // 第一次取到引用之前没有 HEAD，先不显示。
    if (text === undefined) return;
    this.item.text = text;
    this.item.tooltip = titles.length > 0 ? titles.join("\n") : TOGGLE_HINT;
    this.item.show();
  }

  dispose(): void {
    for (const disposable of this.disposables) disposable.dispose();
  }
}
