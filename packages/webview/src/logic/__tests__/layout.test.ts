import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT, restoreLayout, splitPercent } from "../layout.js";

describe("restoreLayout：取回上次的栏宽，格式不对就用默认", () => {
  it("第一次打开没有存过 → 默认 20 / 55 / 25", () => {
    expect(restoreLayout(undefined)).toEqual(DEFAULT_LAYOUT);
    expect(DEFAULT_LAYOUT.inner).toBeCloseTo(68.75);
  });

  it("存过合法的值 → 原样取回", () => {
    expect(restoreLayout({ outer: 30, inner: 50 })).toEqual({ outer: 30, inner: 50 });
  });

  it.each([
    ["缺字段", { outer: 30 }],
    ["不是数字", { outer: "30", inner: 50 }],
    ["超出范围", { outer: 0, inner: 100 }],
    ["不是对象", 42],
  ])("%s → 默认值，不抛", (_name, saved) => {
    expect(restoreLayout(saved)).toEqual(DEFAULT_LAYOUT);
  });
});

describe("splitPercent：从分隔线事件里取百分比", () => {
  it("取到 positionInPercentage", () => {
    const event = new CustomEvent("vsc-split-layout-change", {
      detail: { position: 200, positionInPercentage: 25 },
    });
    expect(splitPercent(event)).toBe(25);
  });

  it("不是 CustomEvent 或缺字段 → undefined", () => {
    expect(splitPercent(new Event("x"))).toBeUndefined();
    expect(splitPercent(new CustomEvent("x", { detail: {} }))).toBeUndefined();
  });
});
