import * as vscode from "vscode";

/** 写进系统剪贴板。复制提交说明、hash、分支名都走这里。 */
export async function copyText(text: string): Promise<void> {
  await vscode.env.clipboard.writeText(text);
}
