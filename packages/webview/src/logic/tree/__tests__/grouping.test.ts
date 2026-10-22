import { describe, expect, it } from "vitest";
import { PopupItemKind } from "../../popupMenu.js";
import { Grouping, groupingMenu, restoreGrouping, saveGrouping } from "../grouping.js";

describe("存、读回分组", () => {
  it("存了再读回，原样；关掉之后也记得", () => {
    for (const on of [new Set([Grouping.Directory]), new Set<Grouping>()]) {
      expect(restoreGrouping(saveGrouping(on))).toEqual(on);
    }
  });

  it("什么都没存、存的认不出：按目录分组；认不出的那项当作没有", () => {
    expect(restoreGrouping(undefined)).toEqual(new Set([Grouping.Directory]));
    expect(restoreGrouping("garbage")).toEqual(new Set([Grouping.Directory]));
    expect(restoreGrouping({ on: ["module"] })).toEqual(new Set());
  });

  it("落盘的是映射表里的字符串", () => {
    expect(saveGrouping(new Set([Grouping.Directory]))).toEqual({ on: ["directory"] });
  });
});

describe("groupingMenu", () => {
  it("一节 Group By，Directory 勾不勾跟着开关；点了交回相反的值", () => {
    const set: [Grouping, boolean][] = [];
    const [title, directory] = groupingMenu(new Set([Grouping.Directory]), (g, v) =>
      set.push([g, v]),
    );
    expect(title).toEqual({ kind: PopupItemKind.Separator, label: "Group By" });
    if (directory?.kind !== PopupItemKind.Toggle) throw new Error("应是勾选项");
    expect(directory.label).toBe("Directory");
    expect(directory.checked).toBe(true);
    directory.toggle(false);
    expect(set).toEqual([[Grouping.Directory, false]]);
  });
});
