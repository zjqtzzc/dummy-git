import { assertNever, DiffOpenMode, type DiffSide, DiffSideKind } from "@dummy-git/shared";

/**
 * 「打开 diff」的判断逻辑。不 import vscode，能在纯 node 下测；
 * 真正找标签、关标签、打开的那几句在 `diff.ts`。
 */

/** 插件已经开着的一个 diff 标签，只取判断要用的两样。 */
export interface OurDiffTab {
  /** 它是不是所在编辑组当前显示的那个（在前台）。 */
  readonly isActive: boolean;
  /** 它所在编辑组的列号。新的 diff 开在这里，位置不跳。 */
  readonly column: number;
}

export type DiffTabPlan =
  | { readonly kind: DiffTabPlanKind.Skip }
  | {
      readonly kind: DiffTabPlanKind.Open;
      /** 开在哪一列；`undefined` 表示没有旧标签，交给 VS Code 决定。 */
      readonly column: number | undefined;
    };

export enum DiffTabPlanKind {
  /** 什么都不做。 */
  Skip = "skip",
  /** 关掉插件所有的 diff 标签，再打开新的。 */
  Open = "open",
}

/**
 * 插件的 diff 始终只占一个标签（需求第 1 阶段）。
 *
 * - `Open`（双击、回车）：总是打开。有旧标签就开在它那一列。
 * - `Follow`（单击、方向键）：只有旧标签正显示在前台时才换；它被挡在后面、
 *   或者根本没开，就什么都不做——不把用户正在看的东西挡住。
 */
export function planDiffTab(tabs: readonly OurDiffTab[], mode: DiffOpenMode): DiffTabPlan {
  const front = tabs.find((tab) => tab.isActive);
  switch (mode) {
    case DiffOpenMode.Open:
      return { kind: DiffTabPlanKind.Open, column: (front ?? tabs[0])?.column };
    case DiffOpenMode.Follow:
      return front === undefined
        ? { kind: DiffTabPlanKind.Skip }
        : { kind: DiffTabPlanKind.Open, column: front.column };
    default:
      return assertNever(mode, "planDiffTab");
  }
}

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
