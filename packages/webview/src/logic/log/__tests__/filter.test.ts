import type { CommitSkeleton } from "@dummy-git/shared";
import { describe, expect, it } from "vitest";
import { applyFilter, DateRange, isFiltering, restoreFilter, saveFilter } from "../filter.js";

const HOUR = 60 * 60;
const NOW = 1_000_000_000;
const commit = (hash: string, hoursAgo: number): CommitSkeleton => ({
  hash,
  parents: [],
  at: NOW - hoursAgo * HOUR,
});
const skeleton = [commit("a", 1), commit("b", 30), commit("c", 24 * 10), commit("d", 24 * 40)];

describe("applyFilter", () => {
  it("没有条件：全部，顺序不变", () => {
    expect(applyFilter(skeleton, {}, NOW)).toEqual(["a", "b", "c", "d"]);
    expect(isFiltering({})).toBe(false);
  });

  it("日期：24 小时、7 天、一个月", () => {
    expect(applyFilter(skeleton, { date: DateRange.Day }, NOW)).toEqual(["a"]);
    expect(applyFilter(skeleton, { date: DateRange.Week }, NOW)).toEqual(["a", "b"]);
    expect(applyFilter(skeleton, { date: DateRange.Month }, NOW)).toEqual(["a", "b", "c"]);
  });
});

describe("saveFilter / restoreFilter", () => {
  it("存了再读回来一样", () => {
    for (const date of Object.values(DateRange)) {
      expect(restoreFilter(saveFilter({ date }))).toEqual({ date });
    }
    expect(restoreFilter(saveFilter({}))).toEqual({});
  });

  it("认不出的当作没有", () => {
    expect(restoreFilter(undefined)).toEqual({});
    expect(restoreFilter({ date: "week" })).toEqual({});
  });
});
