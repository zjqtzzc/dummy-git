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

/**
 * 从几项里勾几项：原生多选 QuickPick，`picked` 是一开始勾着的。返回确认时勾着的序号（按列表顺序），取消是 `undefined`。
 * Log 的 View Options 在用。
 */
export async function pickMany(
  title: string,
  items: readonly PickItem[],
  picked: readonly number[],
): Promise<readonly number[] | undefined> {
  const chosen = await vscode.window.showQuickPick(
    items.map((item, index) => ({ ...item, index, picked: picked.includes(index) })),
    { title, placeHolder: title, canPickMany: true },
  );
  return chosen?.map((item) => item.index).sort((a, b) => a - b);
}
