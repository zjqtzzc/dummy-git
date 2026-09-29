import { assertNever, DiffOpenMode, type DiffSide } from "@dummy-git/shared";
import * as vscode from "vscode";
import { diffTitle } from "./diffTitle.js";
import { REVISION_SCHEME, toRevisionUri } from "./revisionUri.js";

/**
 * 用 VS Code 的 diff 编辑器打开左右两边。**所有文件树都走这一个函数**（`ARCHITECTURE.md` 第 10 题）。
 *
 * 重用 diff 标签靠 VS Code 自己的预览标签：同一组里新的预览替换旧的，不管旧的里面是什么
 * （文本 diff、二进制占位页）。我们不去找标签、也不关标签。
 *
 * - 打开（双击、回车）：直接打开。
 * - 跟随（单击、方向键）：当前编辑组前台是一个 diff（不管是谁打开的）才换，否则不动，
 *   不把 diff 翻到用户正在看的东西前面。
 *
 * 焦点留在调用方（面板），方便用键盘接着翻。
 */
export async function openDiff(
  root: string,
  left: DiffSide,
  right: DiffSide,
  mode: DiffOpenMode,
): Promise<void> {
  switch (mode) {
    case DiffOpenMode.Open:
      break;
    case DiffOpenMode.Follow:
      if (
        !(
          vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputTextDiff
        )
      ) {
        return;
      }
      break;
    default:
      assertNever(mode, "openDiff");
  }
  await vscode.commands.executeCommand(
    "vscode.diff",
    toUri(root, left),
    toUri(root, right),
    diffTitle(left, right),
    { preview: true, preserveFocus: true },
  );
}

function toUri(root: string, side: DiffSide): vscode.Uri {
  const { fsPath, query } = toRevisionUri(root, side);
  return vscode.Uri.file(fsPath).with({ scheme: REVISION_SCHEME, query });
}
