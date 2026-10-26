import { join } from "node:path";
import * as vscode from "vscode";

/**
 * 在编辑器里打开工作区里的文件。走 `vscode.open` 而不是 `showTextDocument`：
 * 图片之类的二进制文件由 VS Code 按类型挑编辑器，`showTextDocument` 打不开。
 */
export async function openFile(root: string, path: string): Promise<void> {
  await vscode.commands.executeCommand(
    "vscode.open",
    vscode.Uri.file(join(root, ...path.split("/"))),
  );
}
