<script lang="ts">
import { assertNever } from "@dummy-git/shared";
import {
  Direction,
  type GraphRow,
  type GraphSegment,
  LineEnd,
  LineStyle,
} from "../logic/log/graph/types.js";
import { ROW_HEIGHT } from "../logic/virtualList.js";

/** 一条车道的宽度，像素。 */
const LANE = 16;
/** 图与文字的间隔，像素。 */
const GAP = 2;

/**
 * 调色板：主题的提交图颜色，加上终端的六种色相各两档（不用黑白，它们贴近背景与文字）。
 * 都是主题变量，各个主题自己保证在背景上看得清。变量缺失时用后备色。
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
import { useId } from "vue";

/**
 * 一行的提交图：每段线从本行节点中心画到相邻行目标位置的中心，超出本行的部分由 SVG 裁掉；
 * 节点最后画，盖在线上。
 */
const props = defineProps<{ row: GraphRow; base: number }>();

const MIDDLE = ROW_HEIGHT / 2;
const RADIUS = 4;
/** 箭头尖离行边缘的距离。 */
const ARROW_GAP = RADIUS / 2 + 1;
/** 箭头两翼：长 0.3 倍行高，与线的夹角约 33°。 */
const WING_ALONG = 0.3 * ROW_HEIGHT * Math.sqrt(0.7);
const WING_ACROSS = 0.3 * ROW_HEIGHT * Math.sqrt(0.3);

const x = (position: number) => position * LANE + LANE / 2;

/** 往下为 1，往上为 -1。 */
function sign(direction: Direction): number {
  switch (direction) {
    case Direction.Up:
      return -1;
    case Direction.Down:
      return 1;
    default:
      return assertNever(direction, "GraphCell.sign");
  }
}

/** 本行朝某个方向的边缘。 */
const edgeY = (direction: Direction) => MIDDLE + sign(direction) * MIDDLE;

/** 渐隐用的渐变，每行各自定义：id 在整个页面里唯一。 */
const uid = useId();
const fadeId = (i: number) => `${uid}-fade-${i}`;

/** 线的颜色。渐隐的线引用本行的渐变，渐变里再取颜色。 */
function strokeOf(segment: GraphSegment, i: number): string | undefined {
  return segment.end === LineEnd.Fade ? `url(#${fadeId(i)})` : paint(segment.color);
}

/** 虚线的空白长度：半个行高减 2。 */
const DASH_GAP = MIDDLE - 2;

/**
 * 虚线：空白长度固定，线段长度凑成整数段，图案从半段线开始，每段线都以行中心对称。
 * 竖线按一个行高算，斜线按两行中心间的长度算。箭头照旧画实线。
 */
function dashOf(segment: GraphSegment): { strokeDasharray: string; strokeDashoffset: number } | undefined {
  switch (segment.style) {
    case LineStyle.Solid:
      return undefined;
    case LineStyle.Dotted: {
      if (segment.end === LineEnd.Arrow) return undefined;
      const length = Math.hypot((segment.to - segment.from) * LANE, ROW_HEIGHT);
      const dash = length / Math.max(1, Math.floor(length / ROW_HEIGHT)) - DASH_GAP;
      return { strokeDasharray: `${dash} ${DASH_GAP}`, strokeDashoffset: dash / 2 };
    }
    default:
      return assertNever(segment.style, "GraphCell.dashOf");
  }
}

/** 一段线的 SVG 路径。接到相邻行的画到相邻行的中心；箭头竖直画到行边缘再加两翼；渐隐竖直画到行边缘。 */
function pathOf(segment: GraphSegment): string {
  const x1 = x(segment.from);
  const s = sign(segment.direction);
  switch (segment.end) {
    case LineEnd.Joined:
      return `M${x1} ${MIDDLE}L${x(segment.to)} ${MIDDLE + s * ROW_HEIGHT}`;
    case LineEnd.Arrow: {
      const tip = MIDDLE + s * (MIDDLE - ARROW_GAP);
      const wing = tip - s * WING_ALONG;
      return `M${x1} ${MIDDLE}L${x1} ${tip}M${x1 - WING_ACROSS} ${wing}L${x1} ${tip}L${x1 + WING_ACROSS} ${wing}`;
    }
    case LineEnd.Fade:
      return `M${x1} ${MIDDLE}L${x1} ${edgeY(segment.direction)}`;
    default:
      return assertNever(segment.end, "GraphCell.pathOf");
  }
}
</script>

<template>
  <svg class="graph" :width="graphWidth(props.row, props.base)" :height="ROW_HEIGHT">
    <defs>
      <template v-for="(segment, i) in props.row.segments" :key="i">
        <!-- userSpaceOnUse：竖线的外框宽度为 0，按外框算的渐变画不出来。 -->
        <linearGradient
          v-if="segment.end === LineEnd.Fade"
          :id="fadeId(i)"
          gradientUnits="userSpaceOnUse"
          x1="0"
          :y1="MIDDLE"
          x2="0"
          :y2="edgeY(segment.direction)"
        >
          <stop offset="0" :style="{ stopColor: paint(segment.color) }" />
          <stop offset="1" :style="{ stopColor: paint(segment.color), stopOpacity: 0 }" />
        </linearGradient>
      </template>
    </defs>
    <path
      v-for="(segment, i) in props.row.segments"
      :key="i"
      :d="pathOf(segment)"
      :style="{ stroke: strokeOf(segment, i), ...dashOf(segment) }"
    />
    <circle
      :cx="x(props.row.nodePosition)"
      :cy="MIDDLE"
      :r="RADIUS"
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
  stroke-linecap: round;
  stroke-linejoin: round;
  /* 主题色与终端色都偏艳，图上统一压低饱和度。 */
  filter: saturate(0.7);
}
.graph path {
  fill: none;
}
.graph circle {
  stroke: none;
}
</style>
