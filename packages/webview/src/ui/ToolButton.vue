<script setup lang="ts">
import Icon from "./Icon.vue";
import type { IconRef } from "./icons.js";

/**
 * 工具按钮。`vscode-toolbar-button` 只认 codicon、也没有 `disabled`，所以自己做一个，
 * 样式照它：22px 见方、悬停用主题的悬停背景、圆角。图标两种来源都行（`IconRef`）。
 * `title` 同时是提示文字与读屏名称。
 */
defineProps<{ icon: IconRef; title: string; disabled?: boolean }>();
</script>

<template>
  <button type="button" class="tool" :title="title" :aria-label="title" :disabled="disabled">
    <Icon :icon="icon" />
  </button>
</template>

<style scoped>
.tool {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 5px;
  background: none;
  color: var(--vscode-icon-foreground);
  cursor: pointer;
}
.tool:hover:not(:disabled) {
  background: var(--vscode-toolbar-hoverBackground);
}
.tool:focus-visible {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: -1px;
}
.tool:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
