<script lang="ts">
import { assertNever } from "@dummy-git/shared";
import { Direction, type GraphRow } from "../logic/log/graph/types.js";
import { ROW_HEIGHT } from "../logic/virtualList.js";

/** 一条车道的宽度，像素。 */
const LANE = 16;
/** 图与文字的间隔，像素。 */
const GAP = 2;

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
    />
    <circle :cx="x(props.row.nodePosition)" :cy="MIDDLE" r="4" />
  </svg>
</template>

<style scoped>
/* 盖在行的左内边距之后、Message 单元格的左内边距上（由 CommitList 按 graphWidth 留出）。 */
.graph {
  position: absolute;
  top: 0;
  left: 8px;
  pointer-events: none;
  stroke: var(--vscode-foreground);
  fill: var(--vscode-foreground);
  stroke-width: 1.5;
}
.graph circle {
  stroke: none;
}
</style>
