import { DiffOpenMode, DiffSideKind } from "@dummy-git/shared";
import { describe, expect, it } from "vitest";
import { DiffTabPlanKind, diffTitle, planDiffTab } from "../diffTab.js";

describe("planDiffTab：插件的 diff 只占一个标签", () => {
  it("双击：没有旧标签 → 打开，位置交给 VS Code", () => {
    expect(planDiffTab([], DiffOpenMode.Open)).toEqual({
      kind: DiffTabPlanKind.Open,
      column: undefined,
    });
  });

  it("双击：旧标签被挡在后面 → 仍然打开，开在它那一列", () => {
    expect(planDiffTab([{ isActive: false, column: 2 }], DiffOpenMode.Open)).toEqual({
      kind: DiffTabPlanKind.Open,
      column: 2,
    });
  });

  it("单击：旧标签正显示在前台 → 跟着换，开在它那一列", () => {
    expect(planDiffTab([{ isActive: true, column: 3 }], DiffOpenMode.Follow)).toEqual({
      kind: DiffTabPlanKind.Open,
      column: 3,
    });
  });

  it("单击：旧标签被挡在后面 → 什么都不做，不挡住用户正在看的东西", () => {
    expect(planDiffTab([{ isActive: false, column: 1 }], DiffOpenMode.Follow)).toEqual({
      kind: DiffTabPlanKind.Skip,
    });
  });

  it("单击：没有旧标签 → 什么都不做", () => {
    expect(planDiffTab([], DiffOpenMode.Follow)).toEqual({ kind: DiffTabPlanKind.Skip });
  });
});

describe("diffTitle", () => {
  it("文件名 + 左右短 hash，不存在的一边写 none", () => {
    const hash = "9c487b97".padEnd(40, "0");
    expect(
      diffTitle(
        { kind: DiffSideKind.Missing, path: "src/a.ts" },
        { kind: DiffSideKind.Revision, hash, path: "src/a.ts" },
      ),
    ).toBe("a.ts (none ↔ 9c487b9)");
  });
});
