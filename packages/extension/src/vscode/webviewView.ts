import { randomBytes } from "node:crypto";
import { assertNever } from "@dummy-git/shared";
import * as vscode from "vscode";
import type { Repository } from "../core/repository.js";
import type { Router, Transport } from "../ipc/router.js";

/**
 * 每次加载一个新的随机串，写进 CSP，也写在 `<script>` 标签上。
 *
 * 作用是「只有这一份我们自己放进去的脚本能跑」。没有它就得开 `'unsafe-inline'`，
 * 那等于对这个页面里**任何**内联脚本放行——而页面里要渲染的是提交消息、
 * 分支名、文件路径，全都来自仓库内容，即别人写的字符串。
 */
function makeNonce(): string {
  return randomBytes(16).toString("base64");
}

/**
 * webview 的 HTML。**用 TypeScript 拼，不改写 vite 生成的 `index.html`。**
 *
 * 两个原因：脚本路径要转成 `vscode-resource:` URI（磁盘路径在 webview 里加载不了），
 * 而 nonce 每次加载都不同——这两件事在别人生成的 HTML 上做都是字符串替换，
 * 做不干净。vite 那边已经把文件名固定成 `webview.js`（见 `vite.config.ts`），
 * 所以这里直接引用就行。
 *
 * HTML 里**不塞任何数据**。webview 启动后自己问 `getRepositories`——
 * 「有哪些仓库」是协议的问题，烤进页面就等于由扩展替用户选好了那一个，
 * 多仓库时还得再拆出来（见 `shared/protocol.ts` 的 `getRepositories`）。
 *
 * 只写一个视图 id（`data-view`），页面按它挂 Log 还是 Commit。两个视图共用一份脚本；
 * 视图 id 本来就是写在 `package.json` 里的外部字符串，不另造一套名字。
 */
function html(webview: vscode.Webview, root: vscode.Uri, viewType: string): string {
  const nonce = makeNonce();
  const asset = (name: string): string =>
    webview.asWebviewUri(vscode.Uri.joinPath(root, "dist", "webview", name)).toString();
  const script = asset("webview.js");
  // vite 把 `main.tsx` 里 import 的 CSS 抽成了单独文件，HTML 必须自己引。
  // 漏掉不会报任何错，只是面板完全没有样式——**只看代码看不出来，看产物才看得见**。
  const style = asset("webview.css");

  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<title>Dummy Git</title>
<link rel="stylesheet" href="${style}">
<link id="vscode-codicon-stylesheet" rel="stylesheet" href="${asset("codicon.css")}">
</head>
<body>
<div id="root" data-view="${viewType}"></div>
<script type="module" nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
}

/** 没有仓库、git 不可用时的页面：只有一句原因，不加载界面脚本。 */
function unavailableHtml(reason: string): string {
  const text = reason.replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
</head>
<body style="font-family: var(--vscode-font-family); color: var(--vscode-descriptionForeground); padding: 12px;">
<p>${text}</p>
</body>
</html>`;
}

export enum ViewSourceKind {
  Repository = "repository",
  Unavailable = "unavailable",
}

/** 视图要显示什么：一个仓库，或者一句「为什么没有」。 */
export type ViewSource =
  | { readonly kind: ViewSourceKind.Repository; readonly repository: Repository }
  | { readonly kind: ViewSourceKind.Unavailable; readonly reason: string };

/**
 * 注册一个 webview 视图：底部面板的 Log、侧栏的 Commit（`ARCHITECTURE.md` 第 1 题）。
 * 两者的装配完全相同，只有视图 id 不同。
 *
 * ## 视图收起就销毁，展开再重建
 *
 * 不开 `retainContextWhenHidden`：每次展开都会重新调 `resolveWebviewView`，
 * 也就是 ready 会来第二次——那正是握手的换代逻辑要处理的情况（`ipc/router.ts`）。
 * 所以一次展开配一个新的 Router，销毁时退订仓库的广播。
 *
 * ## ⚠️ 视图销毁**不**销毁 `Repository`
 *
 * `Repository` 代表仓库，视图只是视图。仓库的生命周期跟 workspace 走，
 * 由 `extension.ts` 的 `context.subscriptions` 管。
 *
 * ## 为什么拿的是 Promise
 *
 * 上次关窗口时面板开着的话，视图可能在仓库还没找完时就要显示。
 */
export function registerWebviewView(
  context: vscode.ExtensionContext,
  /** 与 package.json 的 contributes.views 里的 id 一致。 */
  viewType: string,
  source: Promise<ViewSource>,
  /** 拿着这个视图的 `Transport` 换一个 `Router`。理由同 Router 需要 Transport 才能造。 */
  createRouter: (repository: Repository, transport: Transport) => Router,
): vscode.Disposable {
  return vscode.window.registerWebviewViewProvider(viewType, {
    resolveWebviewView: async (view) => {
      const resolved = await source;
      switch (resolved.kind) {
        case ViewSourceKind.Unavailable:
          view.webview.options = { enableScripts: false };
          view.webview.html = unavailableHtml(resolved.reason);
          return;
        case ViewSourceKind.Repository:
          break;
        default:
          assertNever(resolved, "resolveWebviewView");
      }

      const { repository } = resolved;
      view.webview.options = {
        enableScripts: true,
        // 只允许从扩展自己的 dist 目录读资源。
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")],
      };
      view.webview.html = html(view.webview, context.extensionUri, viewType);

      // 视图销毁后往它 post 会抛。Transport 在这里收口。
      let alive = true;
      const router = createRouter(repository, {
        post: (message) => {
          if (!alive) return;
          void view.webview.postMessage(message);
        },
      });
      const receiving = view.webview.onDidReceiveMessage((raw: unknown) => router.receive(raw));
      // 仓库变了 → 广播给这个视图。只说「哪些域过期了」，要不要重拉由前端决定。
      const unsubscribe = repository.onDidChange((domains) =>
        router.broadcast(repository.location.root, [...domains]),
      );
      view.onDidDispose(() => {
        alive = false;
        receiving.dispose();
        unsubscribe();
      });
    },
  });
}
