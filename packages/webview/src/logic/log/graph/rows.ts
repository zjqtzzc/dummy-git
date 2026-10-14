import {
  Direction,
  type Graph,
  type GraphEdge,
  type GraphRow,
  type GraphSegment,
} from "./types.js";

/**
 * 每行有哪些元素、各在第几个位置，以及每段线在相邻行的落点。
 *
 * 一行的元素 = 本行的节点 + 穿过本行的边（上端在本行之上、下端在本行之下）。元素按编号排序，
 * 位置就是序号：左边有边结束，右边的边下一行自动左移一格，车道始终压紧。
 */

enum ElementKind {
  Node = "node",
  Edge = "edge",
}

type Element =
  | { readonly kind: ElementKind.Node; readonly row: number }
  | { readonly kind: ElementKind.Edge; readonly id: number; readonly edge: GraphEdge };

/** 基准宽度的上限（车道数）。 */
const MAX_BASE = 6;
/** 推荐宽度的加权：最下一行的权重是最上一行的 `K` 倍，靠上的行更能代表打开时看到的样子。 */
const K = 0.1;

export function buildGraph(edges: readonly GraphEdge[], indexes: readonly number[]): Graph {
  const indexOf = (row: number) => indexes.at(row) ?? 0;

  /**
   * 边与节点比：边的编号取两端较大的那个，与节点的编号比；相同时按上端行号比。
   * 边与边比：换算成「边与对方某一端的节点比」。相邻两行用同一套比较，同一条边在两行的相对顺序才一致，线才接得上。
   */
  const edgeVsNode = (edge: GraphEdge, node: number) =>
    Math.max(indexOf(edge.up), indexOf(edge.down)) - indexOf(node) || edge.up - node;
  const edgeVsEdge = (a: GraphEdge, b: GraphEdge) => {
    if (a.up === b.up) return a.down < b.down ? -edgeVsNode(b, a.down) : edgeVsNode(a, b.down);
    return a.up < b.up ? edgeVsNode(a, b.up) : -edgeVsNode(b, a.up);
  };
  const compare = (a: Element, b: Element): number => {
    if (a.kind === ElementKind.Edge && b.kind === ElementKind.Edge)
      return edgeVsEdge(a.edge, b.edge);
    if (a.kind === ElementKind.Edge && b.kind === ElementKind.Node)
      return edgeVsNode(a.edge, b.row);
    if (a.kind === ElementKind.Node && b.kind === ElementKind.Edge)
      return -edgeVsNode(b.edge, a.row);
    return 0;
  };

  const rowCount = indexes.length;
  const startsAt = indexes.map((): number[] => []);
  const endsAt = indexes.map((): number[] => []);
  edges.forEach((edge, id) => {
    startsAt[edge.up]?.push(id);
    endsAt[edge.down]?.push(id);
  });

  // 从上往下扫：到一行先去掉在本行结束的边，剩下的都穿过本行；排好序后再加上从本行出发的边。
  const nodePositions: number[] = [];
  const edgePositions: Map<number, number>[] = [];
  const active = new Set<number>();
  for (let row = 0; row < rowCount; row++) {
    for (const id of endsAt.at(row) ?? []) active.delete(id);
    const elements: Element[] = [{ kind: ElementKind.Node, row }];
    for (const id of active) {
      const edge = edges.at(id);
      if (edge !== undefined) elements.push({ kind: ElementKind.Edge, id, edge });
    }
    elements.sort(compare);
    const positions = new Map<number, number>();
    elements.forEach((element, position) => {
      if (element.kind === ElementKind.Node) nodePositions[row] = position;
      else positions.set(element.id, position);
    });
    edgePositions[row] = positions;
    for (const id of startsAt.at(row) ?? []) active.add(id);
  }

  /** 边在某一行的位置：那一行是它的端点就是节点的位置，否则是它穿过那一行时的位置。 */
  const positionIn = (row: number, id: number, edge: GraphEdge): number => {
    const position =
      edge.up === row || edge.down === row ? nodePositions.at(row) : edgePositions.at(row)?.get(id);
    if (position === undefined) throw new Error(`提交图：边 ${id} 不在第 ${row} 行`);
    return position;
  };

  const rows: GraphRow[] = [];
  for (let row = 0; row < rowCount; row++) {
    const nodePosition = nodePositions.at(row) ?? 0;
    const segments: GraphSegment[] = [];
    const down = (from: number, id: number, edge: GraphEdge) =>
      segments.push({ from, to: positionIn(row + 1, id, edge), direction: Direction.Down });
    const up = (from: number, id: number, edge: GraphEdge) =>
      segments.push({ from, to: positionIn(row - 1, id, edge), direction: Direction.Up });

    for (const id of startsAt.at(row) ?? []) {
      const edge = edges.at(id);
      if (edge !== undefined) down(nodePosition, id, edge);
    }
    for (const id of endsAt.at(row) ?? []) {
      const edge = edges.at(id);
      if (edge !== undefined) up(nodePosition, id, edge);
    }
    for (const [id, position] of edgePositions.at(row) ?? []) {
      const edge = edges.at(id);
      if (edge === undefined) continue;
      up(position, id, edge);
      down(position, id, edge);
    }

    const widest = segments.reduce(
      (max, segment) => Math.max(max, segment.from, (segment.from + segment.to) / 2),
      nodePosition,
    );
    rows.push({ nodePosition, segments, width: widest + 1 });
  }

  return { rows, base: Math.min(MAX_BASE, recommendedWidth(rows)) };
}

/**
 * 推荐宽度：各行宽度的加权平均加一个标准差，四舍五入。权重从上往下按等差数列递减，总和为 1。
 * 代表这个仓库「典型的」图有多宽：少数特别宽的行不把基准撑大。
 */
function recommendedWidth(rows: readonly GraphRow[]): number {
  const n = rows.length;
  if (n <= 1) return n;
  let sum = 0;
  let sumSquares = 0;
  rows.forEach((row, i) => {
    const weight = (2 / (n * (K + 1))) * (1 + ((K - 1) * i) / (n - 1));
    sum += row.width * weight;
    sumSquares += row.width * row.width * weight;
  });
  return Math.round(sum + Math.sqrt(Math.max(0, sumSquares - sum * sum)));
}
