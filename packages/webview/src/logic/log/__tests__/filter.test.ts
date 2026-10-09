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

describe("applyFilter：搜索框", () => {
  const hashed = [
    { hash: "abcd1234", parents: [], at: NOW },
    { hash: "beef0000", parents: [], at: NOW },
    { hash: "cafe0000", parents: [], at: NOW - 24 * 40 * HOUR },
  ];

  it("说明文字命中的与 hash 前缀命中的取并集", () => {
    const text = { text: "ABCD", byMessage: new Set(["beef0000"]) };
    expect(applyFilter(hashed, { text: "ABCD" }, NOW, text)).toEqual(["abcd1234", "beef0000"]);
  });

  it("不到 4 个十六进制字符、或不是十六进制的，不当 hash 前缀", () => {
    expect(applyFilter(hashed, {}, NOW, { text: "abc", byMessage: new Set() })).toEqual([]);
    expect(applyFilter(hashed, {}, NOW, { text: "cafe!", byMessage: new Set() })).toEqual([]);
  });

  it("与日期取交集", () => {
    const text = { text: "cafe", byMessage: new Set(["abcd1234"]) };
    expect(applyFilter(hashed, { date: DateRange.Week }, NOW, text)).toEqual(["abcd1234"]);
  });
});

describe("saveFilter / restoreFilter", () => {
  it("存了再读回来一样", () => {
    for (const date of Object.values(DateRange)) {
      expect(restoreFilter(saveFilter({ date }))).toEqual({ date });
    }
    expect(restoreFilter(saveFilter({}))).toEqual({});
    expect(restoreFilter(saveFilter({ date: DateRange.Day, text: "fix" }))).toEqual({
      date: DateRange.Day,
      text: "fix",
    });
  });

  it("认不出的当作没有", () => {
    expect(restoreFilter(undefined)).toEqual({});
    expect(restoreFilter({ date: "week" })).toEqual({});
  });
});
