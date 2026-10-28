import "./style.css";
// 只引入用到的 vscode-elements 组件，不引整个库。
import "@vscode-elements/elements/dist/vscode-badge/index.js";
import "@vscode-elements/elements/dist/vscode-button/index.js";
import "@vscode-elements/elements/dist/vscode-button-group/index.js";
import "@vscode-elements/elements/dist/vscode-icon/index.js";
import "@vscode-elements/elements/dist/vscode-option/index.js";
import "@vscode-elements/elements/dist/vscode-single-select/index.js";
import "@vscode-elements/elements/dist/vscode-split-layout/index.js";
import "@vscode-elements/elements/dist/vscode-textarea/index.js";
import "@vscode-elements/elements/dist/vscode-textfield/index.js";
import { type Component, createApp } from "vue";
import CommitApp from "./commit/CommitApp.vue";
import LogApp from "./log/LogApp.vue";
import { Client, report, sendReportsTo } from "./logic/client.js";
import PushApp from "./push/PushApp.vue";
import RewordApp from "./reword/RewordApp.vue";
import RollbackApp from "./rollback/RollbackApp.vue";
import StashApp from "./stash/StashApp.vue";
import { transport } from "./vscodeApi.js";

/**
 * 这一代的代号。webview 每次重建（面板隐藏再显示、VSCode 重载）都会重新生成，
 * 双向消息都带上它——上一代的回复到了新一代会被丢弃，不会串台。
 */
const client = new Client(transport, crypto.randomUUID());

window.addEventListener("message", (event) => client.receive(event.data));

// 页面自己的异常也记进扩展的日志。送失败就算了（只剩控制台那份），不能再报一遍，免得来回打转。
sendReportsTo((message, stack) => {
  client.request("reportError", { message, stack }).catch(() => {});
});
// 没被接住的：事件处理器里抛的、没人 await 的 Promise。
window.addEventListener("error", (event) => report(event.error ?? event.message));
window.addEventListener("unhandledrejection", (event) => report(event.reason));

/** 视图 id（扩展侧写在 `data-view` 上，即 package.json 里的 id，对话框的在 `dialogPanel.ts`）→ 根组件。 */
const APPS: Readonly<Record<string, Component>> = {
  "dummyGit.log": LogApp,
  "dummyGit.commit": CommitApp,
  "dummyGit.push": PushApp,
  "dummyGit.rollback": RollbackApp,
  "dummyGit.reword": RewordApp,
  "dummyGit.stash": StashApp,
};
const root = document.getElementById("root");
const app = APPS[root?.dataset["view"] ?? ""];
if (root === null || app === undefined) throw new Error(`未知视图：${root?.dataset["view"]}`);
// 对话框还有它针对的东西（推送对话框是分支名），扩展写在 `data-subject` 上。
const subject = root.dataset["subject"];
const vue = createApp(app, subject === undefined ? { client } : { client, subject });
// 组件渲染、生命周期、侦听器里抛的：Vue 默认只写控制台。
vue.config.errorHandler = (error) => report(error);
vue.mount(root);
