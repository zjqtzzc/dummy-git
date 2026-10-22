import { randomBytes } from "node:crypto";
import { assertNever, type GitDomain } from "@dummy-git/shared";
import * as vscode from "vscode";
import type { Repository } from "../core/repository.js";
import { HiddenBuffer } from "../ipc/hiddenBuffer.js";
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
 * 只写一个视图 id（`data-view`），页面按它挂哪个根组件。所有视图共用一份脚本；
 * 视图 id 本来就是写在 `package.json` 里的外部字符串，不另造一套名字。
 * 对话框另写 `data-subject`：它针对的东西（推送对话框是分支名），是页面身份的一部分，
 * 和视图 id 一样在打开时就定了（`vscode/dialogPanel.ts`）。
 */
export function html(
  webview: vscode.Webview,
  root: vscode.Uri,
  viewType: string,
  subject?: string,
): string {
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
<div id="root" data-view="${viewType}"${subject === undefined ? "" : ` data-subject="${escapeHtml(subject)}"`}></div>
<script type="module" nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
}

/** 写进 HTML 文本或属性值的字符串：分支名里可以有 `&`、`<`、`"`。 */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

/** 没有仓库、git 不可用时的页面：只有一句原因，不加载界面脚本。 */
function unavailableHtml(reason: string): string {
  const text = escapeHtml(reason);
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
 * 注册一个 webview 视图：底部面板的 Log、侧栏的 Commit。
 * 两者的装配完全相同，只有视图 id 不同。
 *
 * ## 收起时保留页面（`retainContextWhenHidden`）
 *
 * 不保留的话，每次展开 VS Code 都重建 iframe，先黑屏几百毫秒再一下子出来。
 * iframe 开始加载之后我们自己用的时间不多（大头是取数据），黑屏在那之前、在 VS Code 里，
 * 只有不重建才省得掉。代价：收起时页面常驻内存；隐藏期间的消息 VS Code 不送，广播要攒着（`HiddenBuffer`）。
 * 窗口刚打开时的第一次展开、或 VS Code 回收了隐藏的页面时，仍会重建：ready 来第二次，
 * 握手的换代逻辑照旧处理（`ipc/router.ts`），所以一次 `resolveWebviewView` 配一个新的 Router，销毁时退订仓库的广播。
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
  /**
   * 每次展开拿这个视图的 `Transport` 造一个 `Router`：Transport 要到展开时才有，所以给工厂不给现成的 Router。
   * 回调的 `source` 是视图 id，日志里记作来源。
   */
  createRouter: (repository: Repository, transport: Transport, source: string) => Router,
): vscode.Disposable {
  return vscode.window.registerWebviewViewProvider(
    viewType,
    {
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
        const router = createRouter(
          repository,
          {
            post: (message) => {
              if (!alive) return;
              void view.webview.postMessage(message);
            },
          },
          viewType,
        );
        const receiving = view.webview.onDidReceiveMessage((raw: unknown) => router.receive(raw));
        // 仓库变了 → 广播给这个视图。只说「哪些域过期了」，要不要重拉由前端决定。
        // 视图隐藏时先攒着，重新可见时一次发出（`HiddenBuffer`）。
        const hidden = new HiddenBuffer(view.visible);
        const broadcast = (domains: readonly GitDomain[]): void => {
          if (domains.length > 0) router.broadcast(repository.location.root, domains);
        };
        const unsubscribe = repository.onDidChange((domains) => broadcast(hidden.changed(domains)));
        const visibility = view.onDidChangeVisibility(() =>
          broadcast(hidden.setVisible(view.visible)),
        );
        view.onDidDispose(() => {
          alive = false;
          receiving.dispose();
          visibility.dispose();
          unsubscribe();
        });
      },
    },
    { webviewOptions: { retainContextWhenHidden: true } },
  );
}
