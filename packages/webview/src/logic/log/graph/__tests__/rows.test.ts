import { type Ref, RefKind } from "@dummy-git/shared";
import { describe, expect, it } from "vitest";
import { buildLayout } from "../layout.js";
import { buildGraph } from "../rows.js";
import { buildStructure, edgesOf } from "../structure.js";
import { Direction, type Graph } from "../types.js";
import { skeleton } from "./skeleton.js";

const local = (name: string, target: string): Ref => ({ kind: RefKind.LocalBranch, name, target });

/** 颜色 id 直接用编号，线的颜色取哪一端一眼可见。 */
function graph(rows: readonly (readonly string[])[], refs: readonly Ref[]): Graph {
  const structure = buildStructure(skeleton(rows));
  const { indexes } = buildLayout(structure, refs);
  return buildGraph(edgesOf(structure), indexes, indexes);
}

/** 每一行往下画的每段线，下一行都有一段反过来往上画的与它对上。 */
function expectJoined(g: Graph): void {
  g.rows.forEach((row, r) => {
    const next = g.rows[r + 1];
    for (const segment of row.segments.filter((s) => s.direction === Direction.Down)) {
      expect(next?.segments).toContainEqual({
        from: segment.to,
        to: segment.from,
        direction: Direction.Up,
        color: segment.color,
      });
    }
  });
}

const FORK = [["f2", "f1"], ["m2", "m1"], ["f1", "m1"], ["m1", "m0"], ["m0"]];
const MERGE = [["merge", "a", "f"], ["f", "base"], ["a", "base"], ["base"]];

describe("buildGraph：位置", () => {
  it("一条直线：都在第 0 个位置，竖线上下相连", () => {
    const g = graph([["c", "b"], ["b", "a"], ["a"]], [local("main", "c")]);
    expect(g.rows.map((row) => row.nodePosition)).toEqual([0, 0, 0]);
    expect(g.rows[1]?.segments).toHaveLength(2);
    expect(g.rows[1]?.segments).toContainEqual({
      from: 0,
      to: 0,
      direction: Direction.Up,
      color: 1,
    });
    expect(g.rows[1]?.segments).toContainEqual({
      from: 0,
      to: 0,
      direction: Direction.Down,
      color: 1,
    });
    expectJoined(g);
  });

  it("分叉：编号大的分支在右；左边的边结束后，右边的节点左移回来", () => {
    const g = graph(FORK, [local("main", "m2"), local("feature", "f2")]);
    // f2 独占第 0 行；m2 那行 main 在左、feature 的边在右；f1 那行 main 的边在左、f1 在右；m1 合回第 0 个位置。
    expect(g.rows.map((row) => row.nodePosition)).toEqual([0, 0, 1, 0, 0]);
    expect(g.rows[0]?.segments).toEqual([{ from: 0, to: 1, direction: Direction.Down, color: 2 }]);
    expect(g.rows[2]?.segments).toContainEqual({
      from: 1,
      to: 0,
      direction: Direction.Down,
      color: 2,
    });
    expectJoined(g);
  });

  it("合并：第二个父提交的分支在右，合回后左移；线取编号较大一端的颜色", () => {
    const g = graph(MERGE, [local("main", "merge")]);
    expect(g.rows.map((row) => row.nodePosition)).toEqual([0, 1, 0, 0]);
    expect(g.rows.map((row) => row.nodeColor)).toEqual([1, 2, 1, 1]);
    expect(g.rows[0]?.segments).toContainEqual({
      from: 0,
      to: 1,
      direction: Direction.Down,
      color: 2,
    });
    expectJoined(g);
  });

  it("并行的边按编号排，与谁先出发无关", () => {
    // feature 的边先出发，但 main 编号小，o 那行 main 的边仍在左；两条边都走直线。
    const g = graph(
      [["f", "fb"], ["m", "mb"], ["o"], ["fb", "mb"], ["mb"]],
      [local("main", "m"), local("feature", "f"), local("other", "o")],
    );
    expect(g.rows.map((row) => row.nodePosition)).toEqual([0, 0, 2, 1, 0]);
    expect(g.rows[1]?.segments).toContainEqual({
      from: 1,
      to: 1,
      direction: Direction.Down,
      color: 2,
    });
    expect(g.rows[2]?.segments).toContainEqual({
      from: 0,
      to: 0,
      direction: Direction.Down,
      color: 1,
    });
    expectJoined(g);
  });
});

describe("buildGraph：宽度", () => {
  it("斜线在本行只画一半，按半格算", () => {
    const g = graph(FORK, [local("main", "m2"), local("feature", "f2")]);
    // f2 在第 0 个位置，往下斜到第 1 个位置：最右到 0.5，宽 1.5。
    expect(g.rows[0]?.width).toBe(1.5);
    expect(g.rows[1]?.width).toBe(2);
  });

  it("一条直线：基准 1", () => {
    expect(graph([["c", "b"], ["b", "a"], ["a"]], [local("main", "c")]).base).toBe(1);
  });

  it("基准最多 6 条车道", () => {
    // 八个分支从同一个提交分出去：中间几行宽 8。
    const heads = ["h1", "h2", "h3", "h4", "h5", "h6", "h7", "h8"];
    const g = graph(
      [...heads.map((h) => [h, "base"]), ["base"]],
      heads.map((h) => local(h, h)),
    );
    expect(Math.max(...g.rows.map((row) => row.width))).toBe(8);
    expect(g.base).toBe(6);
  });
});
