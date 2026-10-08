<script setup lang="ts">
import { type AppIcon, ICON_STROKES } from "./icons.js";

/** 画一个我们自己的图标（`icons.ts`）。大小 16×16，颜色继承 `color`。 */
defineProps<{ name: AppIcon }>();
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
      :stroke-dasharray="stroke.dashed ? '1.5 1.5' : undefined"
    />
  </svg>
</template>

<style scoped>
.icon {
  display: block;
  flex: none;
}
</style>
