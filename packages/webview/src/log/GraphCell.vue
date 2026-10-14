<script lang="ts">
import { assertNever } from "@dummy-git/shared";
import { Direction, type GraphRow } from "../logic/log/graph/types.js";
import { ROW_HEIGHT } from "../logic/virtualList.js";

/** 一条车道的宽度，像素。 */
const LANE = 16;
/** 图与文字的间隔，像素。 */
const GAP = 2;

/**
 * 调色板：主题的提交图颜色，加上终端的六种色相各两档（不用黑白，它们贴近背景与文字）。
 * 都是主题变量，各个主题自己保证在背景上看得清。变量缺失时用后备色（同 VS Code 深色主题的默认值）。
 */
const PALETTE = [
  "var(--vscode-scmGraph-foreground1, #ffb000)",
  "var(--vscode-scmGraph-foreground2, #dc267f)",
  "var(--vscode-scmGraph-foreground3, #994f00)",
  "var(--vscode-scmGraph-foreground4, #40b0a6)",
  "var(--vscode-scmGraph-foreground5, #b66dff)",
  "var(--vscode-terminal-ansiRed, #cd3131)",
  "var(--vscode-terminal-ansiGreen, #0dbc79)",
  "var(--vscode-terminal-ansiYellow, #e5e510)",
  "var(--vscode-terminal-ansiBlue, #2472c8)",
  "var(--vscode-terminal-ansiMagenta, #bc3fbc)",
  "var(--vscode-terminal-ansiCyan, #11a8cd)",
  "var(--vscode-terminal-ansiBrightRed, #f14c4c)",
  "var(--vscode-terminal-ansiBrightGreen, #23d18b)",
  "var(--vscode-terminal-ansiBrightYellow, #f5f543)",
  "var(--vscode-terminal-ansiBrightBlue, #3b8eea)",
  "var(--vscode-terminal-ansiBrightMagenta, #d670d6)",
  "var(--vscode-terminal-ansiBrightCyan, #29b8db)",
];
/** 头上没有 ref 的主链。 */
const DEFAULT_COLOR = "var(--vscode-descriptionForeground)";

function paint(color: number | undefined): string | undefined {
  return color === undefined ? DEFAULT_COLOR : PALETTE.at(color % PALETTE.length);
}

/** 图占的宽度，像素：比基准窄的行按基准算，文字对齐；比基准宽的行单独往右退。 */
export function graphWidth(row: GraphRow, base: number): number {
  return Math.max(row.width, base) * LANE + GAP;
}
</script>

<script setup lang="ts">
/**
 * 一行的提交图：每段线从本行节点中心画到相邻行目标位置的中心，超出本行的部分由 SVG 裁掉；
 * 节点最后画，盖在线上。
 */
const props = defineProps<{ row: GraphRow; base: number }>();

const MIDDLE = ROW_HEIGHT / 2;

const x = (position: number) => position * LANE + LANE / 2;

function targetY(direction: Direction): number {
  switch (direction) {
    case Direction.Up:
      return MIDDLE - ROW_HEIGHT;
    case Direction.Down:
      return MIDDLE + ROW_HEIGHT;
    default:
      return assertNever(direction, "GraphCell.targetY");
  }
}
</script>

<template>
  <svg class="graph" aria-hidden="true" :width="graphWidth(props.row, props.base)" :height="ROW_HEIGHT">
    <line
      v-for="(segment, i) in props.row.segments"
      :key="i"
      :x1="x(segment.from)"
      :y1="MIDDLE"
      :x2="x(segment.to)"
      :y2="targetY(segment.direction)"
      :style="{ stroke: paint(segment.color) }"
    />
    <circle
      :cx="x(props.row.nodePosition)"
      :cy="MIDDLE"
      r="4"
      :style="{ fill: paint(props.row.nodeColor) }"
    />
  </svg>
</template>

<style scoped>
/* 盖在行的左内边距之后、Message 单元格的左内边距上（由 CommitList 按 graphWidth 留出）。 */
.graph {
  position: absolute;
  top: 0;
  left: 8px;
  pointer-events: none;
  stroke-width: 1.5;
  /* 主题色与终端色都偏艳，图上统一压低饱和度（IDEA 的提交图饱和度是 0.4）。 */
  filter: saturate(0.7);
}
.graph circle {
  stroke: none;
}
</style>
