import * as vscode from "vscode";

/** 列出前几个文件名，更多的以 `…` 结尾。 */
const LISTED = 5;

/**
 * Rollback 前的确认（`.notes/design/phase-2.md` 第二节第 9 条）：VS Code 原生模态框，
 * 写明文件数、列出前 5 个文件名，按钮 `Rollback`，另有自带的取消。改动删了找不回来，所以要拦一下。
 * 只写文件名、不写目录：意思到了就行，长路径在对话框里反而难读。
 */
export async function confirmRollback(paths: readonly string[]): Promise<boolean> {
  const count = paths.length === 1 ? "1 file" : `${paths.length} files`;
  const listed = paths.slice(0, LISTED).map((path) => path.slice(path.lastIndexOf("/") + 1));
  const detail = [...listed, ...(paths.length > LISTED ? ["…"] : [])].join("\n");
  const pick = await vscode.window.showWarningMessage(
    `Rollback ${count}? This cannot be undone.`,
    { modal: true, detail },
    "Rollback",
  );
  return pick === "Rollback";
}

/** 删除这类找不回或影响别人的操作前的确认：原生模态框，`action` 是确认按钮，另有自带的取消。 */
export async function confirm(message: string, action: string): Promise<boolean> {
  return (await vscode.window.showWarningMessage(message, { modal: true }, action)) === action;
}
