import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT, restoreLayout, splitPosition } from "../layout.js";

describe("restoreLayout：取回上次的栏宽（像素），格式不对就用默认", () => {
  it("第一次打开没有存过 → 默认 240 / 320", () => {
    expect(restoreLayout(undefined)).toEqual({ left: 240, right: 320 });
  });

  it("存过合法的值 → 原样取回", () => {
    expect(restoreLayout({ left: 300, right: 400 })).toEqual({ left: 300, right: 400 });
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
