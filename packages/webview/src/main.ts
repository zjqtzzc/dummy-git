import "./style.css";
// 只引入用到的 vscode-elements 组件，不引整个库。
import "@vscode-elements/elements/dist/vscode-badge/index.js";
import "@vscode-elements/elements/dist/vscode-button/index.js";
import "@vscode-elements/elements/dist/vscode-button-group/index.js";
import "@vscode-elements/elements/dist/vscode-checkbox/index.js";
import "@vscode-elements/elements/dist/vscode-icon/index.js";
import "@vscode-elements/elements/dist/vscode-option/index.js";
import "@vscode-elements/elements/dist/vscode-single-select/index.js";
import "@vscode-elements/elements/dist/vscode-split-layout/index.js";
import "@vscode-elements/elements/dist/vscode-textarea/index.js";
import "@vscode-elements/elements/dist/vscode-textfield/index.js";
import { type Component, createApp } from "vue";
import CommitApp from "./commit/CommitApp.vue";
import LogApp from "./log/LogApp.vue";
import { Client } from "./logic/client.js";
import PushApp from "./push/PushApp.vue";
import { transport } from "./vscodeApi.js";

/**
 * 这一代的代号。webview 每次重建（面板隐藏再显示、VSCode 重载）都会重新生成，
 * 双向消息都带上它——上一代的回复到了新一代会被丢弃，不会串台。
 */
const client = new Client(transport, crypto.randomUUID());

window.addEventListener("message", (event) => client.receive(event.data));

/** 视图 id（扩展侧写在 `data-view` 上，即 package.json 里的 id，对话框的在 `dialogPanel.ts`）→ 根组件。 */
const APPS: Readonly<Record<string, Component>> = {
  "dummyGit.log": LogApp,
  "dummyGit.commit": CommitApp,
  "dummyGit.push": PushApp,
};
const root = document.getElementById("root");
const app = APPS[root?.dataset["view"] ?? ""];
if (root === null || app === undefined) throw new Error(`未知视图：${root?.dataset["view"]}`);
// 对话框还有它针对的东西（推送对话框是分支名），扩展写在 `data-subject` 上。
const subject = root.dataset["subject"];
createApp(app, subject === undefined ? { client } : { client, subject }).mount(root);
