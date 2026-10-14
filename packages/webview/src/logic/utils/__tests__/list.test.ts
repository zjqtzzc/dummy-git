import { describe, expect, it } from "vitest";
import { keepIfSame } from "../list.js";

describe("keepIfSame", () => {
  it("内容相同：沿用上一次的数组", () => {
    const previous = ["a", "b"];
    expect(keepIfSame(previous, ["a", "b"])).toBe(previous);
  });

  it("内容不同或第一次：用新的", () => {
    const next = ["a", "c"];
    expect(keepIfSame(["a", "b"], next)).toBe(next);
    expect(keepIfSame(["a"], next)).toBe(next);
    expect(keepIfSame(undefined, next)).toBe(next);
  });

  it("给了比较函数：按它判断相同", () => {
    const previous = [{ id: 1 }];
    const same = (a: { id: number }, b: { id: number }) => a.id === b.id;
    expect(keepIfSame(previous, [{ id: 1 }], same)).toBe(previous);
    expect(keepIfSame(previous, [{ id: 2 }], same)).not.toBe(previous);
  });
});
