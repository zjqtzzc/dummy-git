import { describe, expect, it } from "vitest";
import { skeleton } from "../graph/__tests__/skeleton.js";
import {
  Highlight,
  headReach,
  isMine,
  restoreHighlights,
  rowHighlight,
  saveHighlights,
} from "../highlight.js";

describe("headReach", () => {
  // e 是 HEAD，合并了 side 上的 x；y 只在别的分支上。
  const graph = skeleton([
    ["y", "c"],
    ["e", "d", "x"],
    ["x", "b"],
    ["d", "c"],
    ["c", "b"],
    ["b", "a"],
    ["a"],
  ]);

  it("沿全部父提交往下走，合并进来的那一支也算；别的分支上的不算", () => {
    expect([...headReach(graph, ["e"])].sort()).toEqual(["a", "b", "c", "d", "e", "x"]);
  });

  it("几个起点（交叉合并的合并基点）：各自往下走的并集", () => {
    expect([...headReach(graph, ["x", "d"])].sort()).toEqual(["a", "b", "c", "d", "x"]);
  });

  it("父提交不在骨架里就停；起点不在骨架里、没有起点时一条都没有", () => {
    expect([...headReach(skeleton([["b", "a"]]), ["b"])]).toEqual(["b"]);
    expect(headReach(graph, ["z"]).size).toBe(0);
    expect(headReach(graph, []).size).toBe(0);
  });
});

describe("rowHighlight", () => {
  const all = new Set(Object.values(Highlight));
  const every = { inHead: true, merge: true, mine: true };

  it("三种各管一样，全叠上", () => {
    expect(rowHighlight(every, all)).toEqual({ tinted: true, dimmed: true, bold: true });
    expect(rowHighlight({ inHead: false, merge: false, mine: false }, all)).toEqual({
      tinted: false,
      dimmed: false,
      bold: false,
    });
  });

  it("关掉的那种不起作用，别的照旧", () => {
    expect(rowHighlight(every, new Set([Highlight.MyCommits]))).toEqual({
      tinted: false,
      dimmed: false,
      bold: true,
    });
    expect(rowHighlight(every, new Set([Highlight.CurrentBranch, Highlight.MergeCommits]))).toEqual(
      { tinted: true, dimmed: true, bold: false },
    );
  });
});

describe("isMine", () => {
  const me = { name: "Ann", email: "ann@x" };

  it("名字和邮箱都相等才是", () => {
    expect(isMine({ name: "Ann", email: "ann@x" }, me)).toBe(true);
    expect(isMine({ name: "Ann", email: "ann@y" }, me)).toBe(false);
    expect(isMine({ name: "ann", email: "ann@x" }, me)).toBe(false);
  });

  it("没有「我」时都不是", () => {
    expect(isMine({ name: "Ann", email: "ann@x" }, null)).toBe(false);
  });
});

describe("存、读回开关", () => {
  const all = Object.values(Highlight);

  it("存了再读回，原样", () => {
    for (const enabled of [new Set(all), new Set([Highlight.MyCommits]), new Set<Highlight>()]) {
      expect(restoreHighlights(saveHighlights(enabled))).toEqual(enabled);
    }
  });

  it("什么都没存、存的认不出：全开；认不出的那项当作没有", () => {
    expect(restoreHighlights(undefined)).toEqual(new Set(all));
    expect(restoreHighlights("garbage")).toEqual(new Set(all));
    expect(restoreHighlights({ off: ["merge-commits", "renamed-later", 3] })).toEqual(
      new Set([Highlight.MyCommits, Highlight.CurrentBranch]),
    );
  });

  it("落盘的是映射表里的字符串，不是 enum 的值", () => {
    expect(saveHighlights(new Set())).toEqual({
      off: ["my-commits", "merge-commits", "current-branch"],
    });
  });
});
