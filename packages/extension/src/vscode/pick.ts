import * as vscode from "vscode";
import type { PickItem } from "../ipc/handlers.js";

/**
 * 从几项里选一项：VS Code 原生 QuickPick，可搜索。返回选中的序号，取消是 `undefined`。
 * Log 过滤栏的按钮在用；以后换成按钮正下方的下拉菜单时只换这一层。
 */
export async function pick(title: string, items: readonly PickItem[]): Promise<number | undefined> {
  const picked = await vscode.window.showQuickPick(
    items.map((item, index) => ({ ...item, index })),
    // 搜索时连灰字一起找：作者列表里打邮箱也能找到人。
    { title, placeHolder: title, matchOnDescription: true },
  );
  return picked?.index;
}
