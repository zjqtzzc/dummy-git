import { assertNever, type Ref, RefKind } from "@dummy-git/shared";
import * as vscode from "vscode";

/** 消费方自有的显示文案映射（CLAUDE.md §B.3）——这张表属于 UI 层，不属于 shared。 */
function refLabel(ref: Ref): string {
  switch (ref.kind) {
    case RefKind.LocalBranch:
      return ref.name;
    case RefKind.RemoteBranch:
      return `${ref.remote}/${ref.name}`;
    case RefKind.Tag:
      return ref.name;
    case RefKind.Head:
      return "HEAD";
    default:
      return assertNever(ref, "refLabel");
  }
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("dummyGit.hello", () => {
      const ref: Ref = { kind: RefKind.Head };
      void vscode.window.showInformationMessage(
        `Dummy Git is alive. Current ref: ${refLabel(ref)}`,
      );
    }),
  );
}

export function deactivate(): void {
  // 无状态，暂无需清理
}
