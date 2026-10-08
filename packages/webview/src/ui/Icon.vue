<script setup lang="ts">
import { type AppIcon, ICON_STROKES } from "./icons.js";

/** 画一个我们自己的图标（`icons.ts`）。大小 16×16，颜色继承 `color`。 */
defineProps<{ name: AppIcon }>();

/** 虚线的「实 空」长度。太密会看起来和实线差不多。 */
const DASH = "3 2";
</script>

<template>
  <svg
    class="icon"
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="1"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path
      v-for="(stroke, index) in ICON_STROKES[name]"
      :key="index"
      :d="stroke.d"
      :stroke-dasharray="stroke.dashed ? DASH : undefined"
    />
  </svg>
</template>

<style scoped>
/*
 * 不接收鼠标：Chromium 在内联 SVG 上悬停时不显示外层元素的 `title`，
 * 让鼠标落到外层（比如按钮）上，提示文字才出得来。
 */
.icon {
  display: block;
  flex: none;
  pointer-events: none;
}
</style>
