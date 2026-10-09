import * as vscode from "vscode";

/**
 * 从几项里选一项：VS Code 原生 QuickPick，可搜索。返回选中的序号，取消是 `undefined`。
 * Log 过滤栏的按钮在用；以后换成按钮正下方的下拉菜单时只换这一层。
 */
export async function pick(title: string, items: readonly string[]): Promise<number | undefined> {
  const picked = await vscode.window.showQuickPick(
    items.map((label, index) => ({ label, index })),
    { title, placeHolder: title },
  );
  return picked?.index;
}
