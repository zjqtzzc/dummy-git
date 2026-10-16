import { join } from "node:path";
import * as vscode from "vscode";
import { REVISION_SCHEME, type RevisionSide, toRevisionUri } from "./revisionUri.js";

/** 合并编辑器的三栏（都由我们的只读文件系统提供）与结果写回的工作区文件。 */
export interface MergeSides {
  readonly base: RevisionSide;
  readonly current: RevisionSide;
  readonly incoming: RevisionSide;
  /** 相对仓库根：结果写回工作区里的这个文件。 */
  readonly output: string;
  /** 左栏标题，比如 `Current (main)`。 */
  readonly currentTitle: string;
  /** 右栏标题，比如 `Incoming (feature)`。 */
  readonly incomingTitle: string;
}

/**
 * 打开 VS Code 的合并编辑器：调内部命令 `_open.mergeEditor`，
 * 三栏用 `dummygit:` URI，输出是工作区里的真实文件。左 Current、右 Incoming，rebase 时也不对调。
 *
 * 每个文件一个标签，我们不主动关合并编辑器：关的时候保存不保存取决于用户在 VS Code 里的选择
 * （勾过「不再询问」就直接保存），而结果一打开就是用基准占位的草稿，替用户关可能把它写进文件。
 *
 * 编辑器里没有 Complete 按钮：保存后回到冲突组标记已解决。调用失败照常抛出，由错误关口报，不退回普通编辑器。
 */
export async function openMergeEditor(root: string, sides: MergeSides): Promise<void> {
  const uri = (side: RevisionSide): vscode.Uri => {
    const { fsPath, query } = toRevisionUri(root, side);
    return vscode.Uri.file(fsPath).with({ scheme: REVISION_SCHEME, query });
  };
  await vscode.commands.executeCommand("_open.mergeEditor", {
    base: uri(sides.base),
    input1: { uri: uri(sides.current), title: sides.currentTitle },
    input2: { uri: uri(sides.incoming), title: sides.incomingTitle },
    output: vscode.Uri.file(join(root, ...sides.output.split("/"))),
  });
}
