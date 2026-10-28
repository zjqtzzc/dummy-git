import { DialogKind } from "@dummy-git/shared";
import * as vscode from "vscode";
import type { Router, Transport } from "../ipc/router.js";
import { html } from "./webviewView.js";

/** 对话框 → 视图 id（页面按它挂根组件，见 `webview/src/main.ts`）。 */
const VIEW_TYPES: Readonly<Record<DialogKind, string>> = {
  [DialogKind.Push]: "dummyGit.push",
  [DialogKind.Reword]: "dummyGit.reword",
  [DialogKind.Rollback]: "dummyGit.rollback",
  [DialogKind.Stash]: "dummyGit.stash",
};

/**
 * 对话框的标签页。每种只开一个。
 *
 * 再开同一种时不新建标签：切过去、重写 HTML。页面整个重新加载，等于关了重开，
 * 上一次的输入不留。重新加载会再握手一次，同一个 Router 按换代处理（`ipc/router.ts`）。
 *
 * 不订阅仓库的广播：对话框只开一会儿，内容在打开时取一次。
 * 切到别的标签再回来时保留页面（`retainContextWhenHidden`），不然输入到一半的东西会丢。
 */
export class DialogPanels {
  private readonly panels = new Map<DialogKind, vscode.WebviewPanel>();

  constructor(
    private readonly extensionUri: vscode.Uri,
    /** 拿着标签页的 `Transport` 换一个 `Router`，同 `webviewView.ts`。`source` 是视图 id，日志里记作来源。 */
    private readonly createRouter: (transport: Transport, source: string) => Router,
  ) {}

  open(dialog: DialogKind, subject: string, title: string): void {
    const existing = this.panels.get(dialog);
    if (existing !== undefined) {
      existing.title = title;
      existing.webview.html = html(
        existing.webview,
        this.extensionUri,
        VIEW_TYPES[dialog],
        subject,
      );
      existing.reveal();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      VIEW_TYPES[dialog],
      title,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        // 只允许从扩展自己的 dist 目录读资源。
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist")],
      },
    );
    panel.webview.html = html(panel.webview, this.extensionUri, VIEW_TYPES[dialog], subject);

    // 标签关掉后往它 post 会抛。
    let alive = true;
    const router = this.createRouter(
      {
        post: (message) => {
          if (!alive) return;
          void panel.webview.postMessage(message);
        },
      },
      VIEW_TYPES[dialog],
    );
    const receiving = panel.webview.onDidReceiveMessage((raw: unknown) => router.receive(raw));
    this.panels.set(dialog, panel);
    panel.onDidDispose(() => {
      alive = false;
      receiving.dispose();
      this.panels.delete(dialog);
    });
  }

  close(dialog: DialogKind): void {
    this.panels.get(dialog)?.dispose();
  }
}
