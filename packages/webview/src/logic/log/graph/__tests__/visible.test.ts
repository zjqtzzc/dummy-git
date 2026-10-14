import { describe, expect, it } from "vitest";
import { buildStructure } from "../structure.js";
import { LineStyle } from "../types.js";
import { visibleLines, visibleRows } from "../visible.js";
import { skeleton } from "./skeleton.js";

const { Solid, Dotted } = LineStyle;

/** 只留下 `shown` 里的提交，返回列表行号表示的线。 */
function lines(rows: readonly (readonly string[])[], shown: readonly string[]) {
  const structure = buildStructure(skeleton(rows));
  const visible = new Set(shown);
  const hashes = rows.flatMap(([hash]) => (hash !== undefined && visible.has(hash) ? [hash] : []));
  return visibleLines(structure, visibleRows(structure, hashes));
}

describe("visibleLines", () => {
  it("全部可见：每条父子关系一条实线，没有渐隐", () => {
    const result = lines([["m", "a", "f"], ["f", "a"], ["a"]], ["m", "f", "a"]);
    expect(result.edges).toEqual([
      { up: 0, down: 2, style: Solid },
      { up: 0, down: 1, style: Solid },
      { up: 1, down: 2, style: Solid },
    ]);
    expect(result.fades).toEqual([[], [], []]);
  });

  it("中间连续几条被藏：两头连一条虚线", () => {
    const result = lines([["d", "c"], ["c", "b"], ["b", "a"], ["a"]], ["d", "a"]);
    expect(result.edges).toEqual([{ up: 0, down: 1, style: Dotted }]);
  });

  it("菱形两边都被藏：只连一条", () => {
    const result = lines([["m", "l", "r"], ["l", "b"], ["r", "b"], ["b"]], ["m", "b"]);
    expect(result.edges).toEqual([{ up: 0, down: 1, style: Dotted }]);
  });

  it("多父合并的父提交都被藏：只连一条", () => {
    const result = lines(
      [["m", "x", "y", "z"], ["x", "b"], ["y", "b"], ["z", "b"], ["b"]],
      ["m", "b"],
    );
    expect(result.edges).toEqual([{ up: 0, down: 1, style: Dotted }]);
  });

  it("已有实线时，经被藏路径到同一个提交不再连虚线", () => {
    // m 的父提交 a 可见，另一个父提交 f 被藏、f 的父提交也是 a。
    const result = lines([["m", "a", "f"], ["f", "a"], ["a"]], ["m", "a"]);
    expect(result.edges).toEqual([{ up: 0, down: 1, style: Solid }]);
  });

  it("可见的子提交已经连过的，不再从父提交那头重复连", () => {
    // c → (b 藏) → a，c 还有可见子提交 d：d 与 c 实线，c 与 a 虚线，d 不再另连 a。
    const result = lines([["d", "c"], ["c", "b"], ["b", "a"], ["a"]], ["d", "c", "a"]);
    expect(result.edges).toEqual([
      { up: 0, down: 1, style: Solid },
      { up: 1, down: 2, style: Dotted },
    ]);
  });

  it("被藏路径通向的后代，可见子提交已经经它连上：不再多连（从上往下扫）", () => {
    // d 合并 h1、h2（都藏）；h1 → c → v，h2 → v。d 与 c 虚线、c 与 v 实线，d 不再直连 v。
    const result = lines(
      [["d", "h1", "h2"], ["h1", "c"], ["h2", "v"], ["c", "v"], ["v"]],
      ["d", "c", "v"],
    );
    expect(result.edges).toEqual([
      { up: 1, down: 2, style: Solid },
      { up: 0, down: 1, style: Dotted },
    ]);
  });

  it("被藏路径通向的祖先，可见父提交已经经它连上：不再多连（从下往上扫）", () => {
    // x 的父提交 p、h2（藏）；p → h1（藏）→ a，h2 → a。x 与 p 实线、p 与 a 虚线，x 不再直连 a。
    const result = lines(
      [["x", "p", "h2"], ["p", "h1"], ["h2", "a"], ["h1", "a"], ["a"]],
      ["x", "p", "a"],
    );
    expect(result.edges).toEqual([
      { up: 0, down: 1, style: Solid },
      { up: 1, down: 2, style: Dotted },
    ]);
  });

  it("沿被藏的路径找不到可见的祖先：虚线渐隐", () => {
    const result = lines([["c", "b"], ["b", "a"], ["a"]], ["c"]);
    expect(result.edges).toEqual([]);
    expect(result.fades).toEqual([[Dotted]]);
  });

  it("被藏的路径通到截断处，也算找不到：虚线渐隐；可见提交自己的父提交被截断：实线渐隐", () => {
    const result = lines(
      [
        ["c", "b"],
        ["b", "gone"],
        ["x", "gone"],
      ],
      ["c", "x"],
    );
    expect(result.fades).toEqual([[Dotted], [Solid]]);
  });
});
