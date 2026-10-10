import { assertNever, type DiffSide, DiffSideKind, IndexStage } from "@dummy-git/shared";

/** 标签标题：`a.ts (1a2b3c4 ↔ 9c487b9)`，不存在的一边写 `none`，工作区文件写 `Working Tree`。 */
export function diffTitle(left: DiffSide, right: DiffSide): string {
  const name = right.path.slice(right.path.lastIndexOf("/") + 1);
  return `${name} (${sideLabel(left)} ↔ ${sideLabel(right)})`;
}

function sideLabel(side: DiffSide): string {
  switch (side.kind) {
    case DiffSideKind.Revision:
      return side.hash.slice(0, 7);
    case DiffSideKind.Missing:
      return "none";
    case DiffSideKind.WorkingTree:
      return "Working Tree";
    case DiffSideKind.Stage:
      return stageLabel(side.stage);
    default:
      return assertNever(side, "sideLabel");
  }
}

function stageLabel(stage: IndexStage): string {
  switch (stage) {
    case IndexStage.Base:
      return "Base";
    case IndexStage.Ours:
      return "Ours";
    case IndexStage.Theirs:
      return "Theirs";
    default:
      return assertNever(stage, "stageLabel");
  }
}
