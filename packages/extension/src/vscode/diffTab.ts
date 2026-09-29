import { assertNever, type DiffSide, DiffSideKind } from "@dummy-git/shared";

/** 标签标题：`a.ts (1a2b3c4 ↔ 9c487b9)`，不存在的一边写 `none`。 */
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
    default:
      return assertNever(side, "sideLabel");
  }
}
