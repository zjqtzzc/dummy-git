import * as vscode from "vscode";
import type { Activity } from "./activity.js";

/** 完成消息在状态栏停多久。 */
const DONE_MS = 4000;

/**
 * 进度出口：「正在做 / 做完了」的统一显示，与错误关口（`errorGate.ts`）对称。
 *
 * 进行中登记到 `activity`，状态栏的分支项转圈、悬停列出 `title`（比如 `Fetching all remotes…`）；
 * 成功后状态栏显示 `done(结果)` 几秒后消失；失败不在这里处理，异常原样抛出，交给错误关口。
 *
 * 由 handler 声明一段操作是什么、做完了怎么说。
 */
export async function withProgress<T>(
  activity: Activity,
  title: string,
  task: () => Promise<T>,
  done: (value: T) => string,
): Promise<T> {
  const value = await activity.run(title, task);
  const message = done(value);
  if (message !== "") notify(message);
  return value;
}

/** 状态栏上几秒的一句话：做完了什么。立刻完成、不值得转圈的操作直接用它。 */
export function notify(message: string): void {
  vscode.window.setStatusBarMessage(message, DONE_MS);
}
