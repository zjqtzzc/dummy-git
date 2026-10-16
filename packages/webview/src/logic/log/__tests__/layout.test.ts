import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT, restoreLayout, splitPercent, splitPosition } from "../layout.js";

describe("restoreLayout：取回上次的栏宽（像素），格式不对就用默认", () => {
  it("第一次打开没有存过 → 默认 240 / 320，文件占右栏 70%", () => {
    expect(restoreLayout(undefined)).toEqual({ left: 240, right: 320, files: 70 });
  });

  it("存过合法的值 → 原样取回", () => {
    expect(restoreLayout({ left: 300, right: 400, files: 55 })).toEqual({
      left: 300,
      right: 400,
      files: 55,
    });
  });

  it("没有上下比例的旧记录、或比例不在 0～100 之间 → 栏宽照样取回，比例用默认", () => {
    const expected = { left: 300, right: 400, files: 70 };
    expect(restoreLayout({ left: 300, right: 400 })).toEqual(expected);
    expect(restoreLayout({ left: 300, right: 400, files: 100 })).toEqual(expected);
  });

  it.each([
    ["缺字段", { left: 300 }],
    ["不是数字", { left: "300", right: 400 }],
    ["不是正数", { left: 0, right: 400 }],
    ["旧格式（百分比那一版）", { outer: 20, inner: 68.75 }],
    ["不是对象", 42],
  ])("%s → 默认值，不抛", (_name, saved) => {
    expect(restoreLayout(saved)).toEqual(DEFAULT_LAYOUT);
  });
});

describe("splitPercent：从分隔线事件里取百分比位置", () => {
  it("取到 positionInPercentage", () => {
    const event = new CustomEvent("x", { detail: { position: 300, positionInPercentage: 62.5 } });
    expect(splitPercent(event)).toBe(62.5);
  });

  it("不是 CustomEvent、缺字段或超出范围 → undefined", () => {
    expect(splitPercent(new Event("x"))).toBeUndefined();
    expect(
      splitPercent(new CustomEvent("x", { detail: { positionInPercentage: 0 } })),
    ).toBeUndefined();
  });
});

describe("splitPosition：从分隔线事件里取像素位置", () => {
  it("取到 position", () => {
    const event = new CustomEvent("vsc-split-layout-change", {
      detail: { position: 240, positionInPercentage: 25 },
    });
    expect(splitPosition(event)).toBe(240);
  });

  it("不是 CustomEvent 或缺字段 → undefined", () => {
    expect(splitPosition(new Event("x"))).toBeUndefined();
    expect(splitPosition(new CustomEvent("x", { detail: {} }))).toBeUndefined();
  });
});
