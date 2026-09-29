import "./style.css";
// 只引入用到的 vscode-elements 组件，不引整个库。
import "@vscode-elements/elements/dist/vscode-icon/index.js";
import "@vscode-elements/elements/dist/vscode-split-layout/index.js";
import "@vscode-elements/elements/dist/vscode-tree/index.js";
import "@vscode-elements/elements/dist/vscode-tree-item/index.js";
import { createApp } from "vue";
import App from "./App.vue";
import { Client } from "./logic/client.js";
import { transport } from "./vscodeApi.js";

/**
 * 这一代的代号。webview 每次重建（面板隐藏再显示、VSCode 重载）都会重新生成，
 * 双向消息都带上它——上一代的回复到了新一代会被丢弃，不会串台。
 */
const client = new Client(transport, crypto.randomUUID());

window.addEventListener("message", (event) => client.receive(event.data));

createApp(App, { client }).mount("#root");
