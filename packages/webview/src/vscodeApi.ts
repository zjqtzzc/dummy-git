import type { ClientTransport } from "./logic/client.js";

/**
 * VSCode 注入给 webview 的唯一 API。
 *
 * **一个页面只能调一次** `acquireVsCodeApi()`，第二次会抛。所以在模块顶层取一次、
 * 存起来——不是为了省事，是这个 API 本身的约束。
 */
interface VsCodeApi {
  readonly postMessage: (message: unknown) => void;
  /** 上一次 `setState` 存的值。webview 收起再展开时还在，重新加载窗口后是 `undefined`。 */
  readonly getState: () => unknown;
  readonly setState: (state: unknown) => void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const api = acquireVsCodeApi();

export const transport: ClientTransport = { post: (message) => api.postMessage(message) };

/** 界面自己的状态（栏宽、展开状态……），收起再展开时恢复（`ARCHITECTURE.md` 第 4 题）。 */
export const viewState = {
  get: (): unknown => api.getState(),
  set: (state: unknown): void => api.setState(state),
};
