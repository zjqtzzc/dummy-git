import "./style.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { Client } from "./client.js";
import { transport } from "./vscodeApi.js";

const container = document.getElementById("root");
if (container === null) throw new Error("页面里没有 #root");

/**
 * 这一代的代号。webview 每次重建（面板隐藏再显示、VSCode 重载）都会重新生成，
 * 双向消息都带上它——上一代的回复到了新一代会被丢弃，不会串台。
 */
const client = new Client(transport, crypto.randomUUID());

window.addEventListener("message", (event) => client.receive(event.data));

createRoot(container).render(
  <StrictMode>
    <App client={client} />
  </StrictMode>,
);
