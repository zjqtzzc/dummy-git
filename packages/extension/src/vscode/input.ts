import * as vscode from "vscode";

/**
 * 问一个分支名：VS Code 原生输入框，边输入边校验。`validate` 返回问题描述时输入框下显示它、确定点不了。
 * 预填的 `value` 默认全选，改名时直接打字就覆盖。取消返回 `undefined`。
 */
export async function askBranchName(
  title: string,
  value: string,
  validate: (name: string) => Promise<string | undefined>,
): Promise<string | undefined> {
  return vscode.window.showInputBox({
    title,
    value,
    placeHolder: "Branch name",
    validateInput: validate,
  });
}
