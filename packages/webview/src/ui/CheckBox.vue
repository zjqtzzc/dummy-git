<script setup lang="ts">
import { CheckState } from "../logic/tree/tree.js";

/**
 * 复选框，所有地方都用它（树里每一行的、Commit 面板的 Amend……）：不用 vscode-elements 的 `vscode-checkbox`，也不各自画。
 * vscode-checkbox 在暗色主题里和背景几乎一样，勾太细，样式也改不进它里面。
 *
 * 外观照 IDEA 新界面（`platform-resources/src/themes/expUI/icons/dark/checkBox*.svg`，换算到 16×16）：
 * 没勾是一个描边的圆角方框，边框比背景明显（暗色主题里浅、亮色主题里深）；勾上、半勾填满蓝色，里面是白色的勾或横条，线宽 2。
 * 勾和横条是控件的一部分，不算图标，不走 `logic/icons.ts` 的线宽 1。
 *
 * 只画、只发出「点了」；勾没勾由用的地方给。带 `label` 时文字跟在后面，点文字也算点了。
 */
defineProps<{ state: CheckState; label?: string; disabled?: boolean }>();
const emit = defineEmits<{ toggle: [] }>();
</script>

<template>
  <span :class="['checkbox', { disabled: disabled === true }]" @click="disabled !== true && emit('toggle')">
    <svg
      :class="['box', { on: state !== CheckState.Unchecked }]"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
    >
      <rect x="0.5" y="0.5" width="15" height="15" rx="2.5" />
      <path
        v-if="state === CheckState.Checked"
        class="mark"
        d="M4 8.5L7 11.5L12.5 5"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <rect v-else-if="state === CheckState.Mixed" class="dash" x="2.5" y="7" width="11" height="2" rx="1" />
    </svg>
    <span v-if="label !== undefined" class="text">{{ label }}</span>
  </span>
</template>

<style scoped>
.checkbox {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: none;
  cursor: default;
}
.box {
  flex: none;
}
/* 没勾：边框是前景色按比例混进透明，暗色主题里比背景浅、亮色主题里比背景深。 */
.box rect:first-child {
  fill: var(--vscode-checkbox-background);
  stroke: color-mix(in srgb, var(--vscode-foreground) 45%, transparent);
}
/* 勾上、半勾：主按钮的蓝，里面用主按钮的字色（一般是白）。 */
.box.on rect:first-child {
  fill: var(--vscode-button-background);
  stroke: var(--vscode-button-background);
}
.mark {
  stroke: var(--vscode-button-foreground);
}
.dash {
  fill: var(--vscode-button-foreground);
}
.disabled {
  opacity: 0.4;
}
</style>
