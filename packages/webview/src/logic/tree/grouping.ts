import { type PopupItem, PopupItemKind } from "../popupMenu.js";

/**
 * 文件树的分组依据（View Options 的 `Group By`）。
 * 现在只有按目录：没有模块这个概念，仓库现阶段也只有一个，按模块、按仓库分都分不出东西。
 */
export enum Grouping {
  Directory = "directory",
}

/** 存进 `viewState` 的写法。 */
const SAVED_GROUPING: Readonly<Record<Grouping, string>> = {
  [Grouping.Directory]: "directory",
};

/** View Options 里的文字。 */
const GROUPING_LABEL: Readonly<Record<Grouping, string>> = {
  [Grouping.Directory]: "Directory",
};

/** 开着的那几种分组。 */
export function saveGrouping(on: ReadonlySet<Grouping>): unknown {
  return { on: [...on].map((grouping) => SAVED_GROUPING[grouping]) };
}

/** 读回存下的分组。什么都没存、存的认不出时按目录分组；认不出的那项当作没有。 */
export function restoreGrouping(saved: unknown): ReadonlySet<Grouping> {
  const on = typeof saved === "object" && saved !== null ? Reflect.get(saved, "on") : undefined;
  if (!Array.isArray(on)) return new Set([Grouping.Directory]);
  return new Set(
    Object.values(Grouping).filter((grouping) => on.includes(SAVED_GROUPING[grouping])),
  );
}

/** View Options 的选单项：一节 `Group By`，每种分组一个勾选项。Commit 面板、Stash 共用。 */
export function groupingMenu(
  on: ReadonlySet<Grouping>,
  set: (grouping: Grouping, value: boolean) => void,
): PopupItem[] {
  return [
    { kind: PopupItemKind.Separator, label: "Group By" },
    ...Object.values(Grouping).map(
      (grouping): PopupItem => ({
        kind: PopupItemKind.Toggle,
        label: GROUPING_LABEL[grouping],
        checked: on.has(grouping),
        toggle: (value) => set(grouping, value),
      }),
    ),
  ];
}
