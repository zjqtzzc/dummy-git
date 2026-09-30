import { describe, expect, it } from "vitest";
import { formatCommitDate } from "../commitDate.js";

const NOW = Math.floor(new Date(2026, 8, 29, 15, 30).getTime() / 1000);

describe("formatCommitDate：一小时以内写多久之前，更早写绝对时间", () => {
  it.each([
    [0, "just now"],
    [59, "just now"],
    [60, "1 minute ago"],
    [5 * 60 + 30, "5 minutes ago"],
    [59 * 60 + 59, "59 minutes ago"],
  ])("%i 秒前 → %s", (ago, text) => {
    expect(formatCommitDate(NOW - ago, NOW)).toBe(text);
  });

  it("一小时及以上 → 年/月/日 时:分，月日不补零，时分补零", () => {
    const at = Math.floor(new Date(2026, 8, 20, 9, 5).getTime() / 1000);
    expect(formatCommitDate(at, NOW)).toBe("2026/9/20 09:05");
  });

  it("未来的时间（时钟不同步）→ 绝对时间，不写负数", () => {
    const at = NOW + 120;
    expect(formatCommitDate(at, NOW)).toMatch(/^2026\/9\/29 15:32$/);
  });
});
