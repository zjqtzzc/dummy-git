<script setup lang="ts">
import { assertNever } from "@dummy-git/shared";
import { computed } from "vue";
import { ICON_STROKES, IconKind, type IconRef, IconSize } from "./icons.js";

/**
 * 画一个图标：「是什么」（`icon`）与「多大」（`size`，默认 `Standard`）任意组合。
 * 颜色继承外面的 `color`。两种来源画法不同，对外一样：
 * - 自己画的 SVG：宽高等于尺寸，坐标系固定 16×16，按比例缩放；
 * - codicon 字体：字号等于尺寸，外面套一个同样大小的方框，和 SVG 占位一致。
 */
const props = withDefaults(defineProps<{ icon: IconRef; size?: IconSize }>(), {
  size: IconSize.Standard,
});

/** 用途 → 像素。新用途在这里加一档。 */
const SIZE_PX: Readonly<Record<IconSize, number>> = {
  [IconSize.Standard]: 16,
  [IconSize.Inline]: 12,
};

/** 虚线的「实 空」长度。太密会看起来和实线差不多。 */
const DASH = "3 2";

const px = computed(() => SIZE_PX[props.size]);

/** codicon 的类名。 */
function codiconClass(icon: IconRef): string {
  switch (icon.kind) {
    case IconKind.Codicon:
      return `codicon-${icon.name}`;
    case IconKind.App:
      return "";
    default:
      return assertNever(icon, "codiconClass");
  }
}
</script>

<template>
  <svg
    v-if="icon.kind === IconKind.App"
    class="icon"
    :width="px"
    :height="px"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="1"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path
      v-for="(stroke, index) in ICON_STROKES[icon.name]"
      :key="index"
      :d="stroke.d"
      :stroke-dasharray="stroke.dashed ? DASH : undefined"
    />
  </svg>
  <span
    v-else
    :class="['icon', 'codicon', codiconClass(icon)]"
    :style="{ width: `${px}px`, height: `${px}px`, fontSize: `${px}px` }"
    aria-hidden="true"
  />
</template>

<style scoped>
/*
 * 不接收鼠标：Chromium 在内联 SVG 上悬停时不显示外层元素的 `title`，
 * 让鼠标落到外层（比如按钮）上，提示文字才出得来。
 */
.icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  pointer-events: none;
}
</style>
