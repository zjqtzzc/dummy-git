import * as vscode from "vscode";

/** 完成消息在状态栏停多久。 */
const DONE_MS = 4000;

/**
 * 进度出口：「正在做 / 做完了」的统一显示，与错误关口（`errorGate.ts`）对称。
 *
 * 进行中在状态栏转圈加 `title`（比如 `Fetching all remotes…`）；成功后状态栏显示 `done(结果)`
 * 几秒后消失；失败不在这里处理，异常原样抛出，交给错误关口。
 *
 * 只显示、不保存状态：「谁在跑」不在这里记。由 handler 声明一段操作是什么、做完了怎么说。
 */
export async function withProgress<T>(
  title: string,
  task: () => Promise<T>,
  done: (value: T) => string,
): Promise<T> {
  const value = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title },
    task,
  );
  vscode.window.setStatusBarMessage(done(value), DONE_MS);
  return value;
}
