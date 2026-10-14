import { describe, expect, it } from "vitest";
import { ColumnHandle, resizeColumns, restoreColumns } from "../columns.js";

const start = { author: 100, date: 120 };

describe("resizeColumns：拖分界线", () => {
  it("Message | Author 往左拖：Author 变宽，Date 不变", () => {
    expect(resizeColumns(start, ColumnHandle.Author, -30)).toEqual({ author: 130, date: 120 });
  });

  it("Author | Date 往右拖：Author 变宽、Date 等量变窄，总宽不变", () => {
    expect(resizeColumns(start, ColumnHandle.Date, 30)).toEqual({ author: 130, date: 90 });
  });

  it("拖过头：两列都不窄于 40", () => {
    expect(resizeColumns(start, ColumnHandle.Author, 500)).toEqual({ author: 40, date: 120 });
    expect(resizeColumns(start, ColumnHandle.Date, 500)).toEqual({ author: 180, date: 40 });
    expect(resizeColumns(start, ColumnHandle.Date, -500)).toEqual({ author: 40, date: 180 });
  });
});

describe("restoreColumns：取回拖过的列宽", () => {
  it("合法 → 原样取回", () => {
    expect(restoreColumns({ author: 100, date: 120 })).toEqual({ author: 100, date: 120 });
  });

  it.each([
    ["没拖过", undefined],
    ["缺字段", { author: 100 }],
    ["不是正数", { author: 0, date: 120 }],
    ["不是对象", 42],
  ])("%s → undefined，用 CSS 默认值", (_name, saved) => {
    expect(restoreColumns(saved)).toBeUndefined();
  });
});
