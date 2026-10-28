import * as vscode from "vscode";

/** 列出前几个名字，更多的以 `…` 结尾。 */
const LISTED = 5;

/** 确认框说明里的名单：前 5 个，一行一个，更多的以 `…` 结尾。 */
function listed(names: readonly string[]): string {
  return [...names.slice(0, LISTED), ...(names.length > LISTED ? ["…"] : [])].join("\n");
}

/**
 * 删除这类找不回或影响别人的操作前的确认：原生模态框，`action` 是确认按钮，另有自带的取消。
 * 给了 `names` 就在说明里列出来（前 5 个），比如一次删好几个分支时。
 */
export async function confirm(
  message: string,
  action: string,
  names?: readonly string[],
): Promise<boolean> {
  const options = names === undefined ? { modal: true } : { modal: true, detail: listed(names) };
  return (await vscode.window.showWarningMessage(message, options, action)) === action;
}

/**
 * 几个按钮选一个（原生通知，不挡窗口）。关掉通知是 `undefined`。
 * 模态框会拦住后面的操作；这里用户可以先不理。
 */
export async function notifyChoice(
  message: string,
  actions: readonly string[],
): Promise<number | undefined> {
  const picked = await vscode.window.showInformationMessage(message, ...actions);
  const index = picked === undefined ? -1 : actions.indexOf(picked);
  return index === -1 ? undefined : index;
}

/** 几个按钮选一个（原生模态框，另有自带的取消）：返回按钮的序号，取消是 `undefined`。 */
export async function choose(
  message: string,
  actions: readonly string[],
  detail?: string,
): Promise<number | undefined> {
  const options = detail === undefined ? { modal: true } : { modal: true, detail };
  const picked = await vscode.window.showWarningMessage(message, options, ...actions);
  const index = picked === undefined ? -1 : actions.indexOf(picked);
  return index === -1 ? undefined : index;
}
