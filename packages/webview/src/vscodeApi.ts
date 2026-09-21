import type { ClientTransport } from "./client.js";

/**
 * VSCode 注入给 webview 的唯一 API。
 *
 * **一个页面只能调一次** `acquireVsCodeApi()`，第二次会抛。所以在模块顶层取一次、
 * 存起来——不是为了省事，是这个 API 本身的约束。
 */
interface VsCodeApi {
  readonly postMessage: (message: unknown) => void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const api = acquireVsCodeApi();

export const transport: ClientTransport = { post: (message) => api.postMessage(message) };
