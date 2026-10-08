import { describe, expect, it } from "vitest";
import { formatTime } from "../time.js";

const NOW = Math.floor(new Date(2026, 8, 29, 15, 30).getTime() / 1000);
const at = (...parts: [number, number, number, number, number]) =>
  Math.floor(new Date(...parts).getTime() / 1000);

describe("formatTime：一小时内写多久之前，今天写 Today，更早写日期", () => {
  it.each([
    [0, "just now"],
    [59, "just now"],
    [60, "1 minute ago"],
    [5 * 60 + 30, "5 minutes ago"],
    [59 * 60 + 59, "59 minutes ago"],
  ])("%i 秒前 → %s", (ago, text) => {
    expect(formatTime(NOW - ago, NOW)).toBe(text);
  });

  it("今天、一小时以前 → Today 时:分（时分补零）", () => {
    expect(formatTime(at(2026, 8, 29, 9, 5), NOW)).toBe("Today 09:05");
    expect(formatTime(at(2026, 8, 29, 0, 0), NOW)).toBe("Today 00:00");
  });

  it("昨天及更早 → 年/月/日 时:分，月日不补零", () => {
    expect(formatTime(at(2026, 8, 28, 23, 59), NOW)).toBe("2026/9/28 23:59");
    expect(formatTime(at(2026, 8, 20, 9, 5), NOW)).toBe("2026/9/20 09:05");
  });

  it("未来的时间（时钟不同步）→ 不写负数", () => {
    expect(formatTime(NOW + 120, NOW)).toBe("Today 15:32");
  });
});
