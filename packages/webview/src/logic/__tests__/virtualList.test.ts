import { describe, expect, it } from "vitest";
import { keepRowInPlace, ROW_HEIGHT, renderRange, scrollToReveal } from "../virtualList.js";

describe("renderRange：只渲染看得见的几十行", () => {
  it("顶部：从第 0 行起，下方多留余量", () => {
    // 视口 220px = 10 行，+1 行半截，+10 行余量
    expect(renderRange(0, 10 * ROW_HEIGHT, 10_000)).toEqual({ start: 0, end: 21 });
  });

  it("中间：上下各留余量", () => {
    expect(renderRange(100 * ROW_HEIGHT, 10 * ROW_HEIGHT, 10_000)).toEqual({ start: 90, end: 121 });
  });

  it("底部：不超过总行数", () => {
    expect(renderRange(95 * ROW_HEIGHT, 10 * ROW_HEIGHT, 100)).toEqual({ start: 85, end: 100 });
  });

  it("行数少于一屏", () => {
    expect(renderRange(0, 10 * ROW_HEIGHT, 3)).toEqual({ start: 0, end: 3 });
  });
});

describe("scrollToReveal：让某一行出现在视口里", () => {
  const viewport = 10 * ROW_HEIGHT;

  it("已经看得见 → 不动", () => {
    expect(scrollToReveal(5, 0, viewport)).toBe(0);
  });

  it("看不见 → 滚到让它居中", () => {
    expect(scrollToReveal(100, 0, viewport)).toBe(100 * ROW_HEIGHT - (viewport - ROW_HEIGHT) / 2);
  });

  it("靠近顶部时不滚成负数", () => {
    expect(scrollToReveal(1, 50 * ROW_HEIGHT, viewport)).toBe(0);
  });
});

describe("keepRowInPlace：刷新后选中行停在原处", () => {
  it("上方多了 3 条新提交 → 往下多滚 3 行", () => {
    expect(keepRowInPlace(10, 13, 200)).toBe(200 + 3 * ROW_HEIGHT);
  });

  it("不会滚成负数", () => {
    expect(keepRowInPlace(10, 0, 50)).toBe(0);
  });
});
