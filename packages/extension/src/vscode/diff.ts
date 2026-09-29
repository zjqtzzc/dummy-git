import type { DiffOpenMode, DiffSide } from "@dummy-git/shared";
import * as vscode from "vscode";
import { DiffTabPlanKind, diffTitle, planDiffTab } from "./diffTab.js";
import { REVISION_SCHEME, toRevisionUri } from "./revisionUri.js";

/**
 * 用 VS Code 的 diff 编辑器打开左右两边。**所有文件树都走这一个函数**（`ARCHITECTURE.md` 第 10 题）。
 *
 * 判断在 `diffTab.ts`；这里只做 VS Code 那几句：找出插件开着的 diff 标签、关掉、打开新的。
 * 焦点留在调用方（面板），方便用键盘接着翻。
 */
export async function openDiff(
  root: string,
  left: DiffSide,
  right: DiffSide,
  mode: DiffOpenMode,
): Promise<void> {
  const ours = vscode.window.tabGroups.all.flatMap((group) =>
    group.tabs.filter(isOurDiffTab).map((tab) => ({ tab, group })),
  );
  const plan = planDiffTab(
    ours.map(({ tab, group }) => ({ isActive: tab.isActive, column: group.viewColumn })),
    mode,
  );
  if (plan.kind === DiffTabPlanKind.Skip) return;

  await vscode.window.tabGroups.close(ours.map(({ tab }) => tab));
  await vscode.commands.executeCommand(
    "vscode.diff",
    toUri(root, left),
    toUri(root, right),
    diffTitle(left, right),
    {
      preview: false,
      preserveFocus: true,
      ...(plan.column === undefined ? {} : { viewColumn: plan.column }),
    },
  );
}

function toUri(root: string, side: DiffSide): vscode.Uri {
  const { fsPath, query } = toRevisionUri(root, side);
  return vscode.Uri.file(fsPath).with({ scheme: REVISION_SCHEME, query });
}

/** 两边有任意一边是我们的 scheme，就算插件开的 diff。以后工作区那一边是 `file:`。 */
function isOurDiffTab(tab: vscode.Tab): boolean {
  const input = tab.input;
  return (
    input instanceof vscode.TabInputTextDiff &&
    (input.original.scheme === REVISION_SCHEME || input.modified.scheme === REVISION_SCHEME)
  );
}
