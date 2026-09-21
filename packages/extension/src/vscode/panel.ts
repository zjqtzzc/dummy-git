import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import type { Router, Transport } from "../ipc/router.js";

const VIEW_TYPE = "dummyGit.log";

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
 */
function html(webview: vscode.Webview, root: vscode.Uri): string {
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
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<title>Dummy Git</title>
<link rel="stylesheet" href="${style}">
</head>
<body>
<div id="root"></div>
<script type="module" nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
}

/**
 * 打开（或聚焦）日志面板。
 *
 * ## ⚠️ 面板销毁**不**销毁 `Repository`
 *
 * 看起来自然的 `panel.onDidDispose(() => repository.dispose())` 是错的：
 * `dispose()` 把 `Repository` 置为 `Disposed`，此后**拒绝一切 git 命令**
 * （`core/repository.ts` 的 `run()` 开头就挡）。用户关一次面板，扩展就废了，重开也没用。
 *
 * `Repository` 代表**仓库**，面板只是**视图**。视图来来去去，仓库状态机不跟着走；
 * 它的生命周期跟 workspace 走，由 `extension.ts` 的 `context.subscriptions` 管。
 *
 * ## 不开 `retainContextWhenHidden`
 *
 * 不开的话，面板隐藏时 webview 会被销毁，再显示时重建——也就是
 * **ready 会来第二次**。那正是握手要处理的情况（`ipc/router.ts` 的换代逻辑），
 * 开了反而把它藏起来，等到别的地方（VSCode 重载）再冒出来。
 * 它还很费内存：隐藏的页面一直占着。
 */
export function openLogPanel(
  context: vscode.ExtensionContext,
  /**
   * 拿着这个面板的 `Transport` 换一个 `Router`。
   *
   * 顺序是刻意的：`Router` 需要 `Transport`，而 `Transport` 只有面板建好才有。
   * 反过来写（先建 Router、事后 `setTransport`）就要给 `Router` 开一个可变字段，
   * 且中间那段时间它拿着一个假的出口——**一个不可能正确的中间状态**。
   * 让面板来提供，就没有那个中间状态。
   */
  createRouter: (transport: Transport) => Router,
  /**
   * 把这个面板的 `Router` 接到仓库的变更通知上，返回退订函数。
   *
   * **退订必须发生在面板销毁时**：`Repository` 跟着 workspace 走，比面板活得久，
   * 每开一个面板就多一个订阅。不退的话监听器只增不减，
   * 已经关掉的面板还在收广播（虽然 post 被 `alive` 挡住，监听器本身还是泄漏）。
   */
  subscribe: (router: Router) => () => void,
): void {
  const panel = vscode.window.createWebviewPanel(VIEW_TYPE, "Dummy Git", vscode.ViewColumn.Active, {
    enableScripts: true,
    // 只允许从扩展自己的 dist 目录读资源。
    localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")],
  });

  panel.webview.html = html(panel.webview, context.extensionUri);

  // 面板没了之后，往它 post 会抛。Transport 在这里收口：
  // `Router` 的 `respondOnce` 已经保证「回两次」不可能，这里保证「往死面板发」不炸。
  let alive = true;
  const router = createRouter({
    post: (message) => {
      if (!alive) return;
      void panel.webview.postMessage(message);
    },
  });

  panel.webview.onDidReceiveMessage(
    (raw: unknown) => router.receive(raw),
    undefined,
    context.subscriptions,
  );
  const unsubscribe = subscribe(router);
  panel.onDidDispose(
    () => {
      alive = false;
      unsubscribe();
      // 刻意不碰 repository——见上面的说明。
    },
    undefined,
    context.subscriptions,
  );
}
