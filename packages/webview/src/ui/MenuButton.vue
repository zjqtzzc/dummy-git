<script setup lang="ts">
import { onUnmounted, ref } from "vue";
import type { IconRef } from "../logic/icons.js";
import type { PopupItem } from "../logic/popupMenu.js";
import type { Rect } from "../logic/popupPlacement.js";
import PopupMenu from "./PopupMenu.vue";
import ToolButton from "./ToolButton.vue";

/**
 * 有选单的图标按钮：基础按钮 `ToolButton` 之上多三件事——右下角画小三角（同 IDEA：点了弹一组选项的工具栏按钮都有），
 * 点了打开贴着按钮的浮层选单（再点一次关上），点外面、按 Esc、webview 失去焦点时收起。
 * 选单是什么由用的地方交 `items`，这里不认识具体选单（`logic/popupMenu.ts`）。
 */
const props = defineProps<{ icon: IconRef; title: string; items: readonly PopupItem[]; disabled?: boolean }>();

const host = ref<HTMLElement>();
/** 开着时是按钮的位置，选单贴着它弹出。 */
const anchor = ref<Rect>();

function toggle(): void {
  if (anchor.value !== undefined) {
    close();
    return;
  }
  if (host.value === undefined || props.disabled === true) return;
  anchor.value = host.value.getBoundingClientRect();
  document.addEventListener("pointerdown", onPointerdown, true);
  document.addEventListener("keydown", onKeydown);
  window.addEventListener("blur", close);
}

function close(): void {
  anchor.value = undefined;
  document.removeEventListener("pointerdown", onPointerdown, true);
  document.removeEventListener("keydown", onKeydown);
  window.removeEventListener("blur", close);
}
onUnmounted(close);

/** 按在选单外面就收起。按在按钮上不算：交给按钮自己的点击去关，否则这里先关、点击又打开。 */
function onPointerdown(event: PointerEvent): void {
  if (!(event.target instanceof Node)) return;
  if (host.value?.contains(event.target) === true) return;
  if (event.target instanceof Element && event.target.closest("[data-popup]") !== null) return;
  close();
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") close();
}
</script>

<template>
  <span ref="host" :class="['menu-button', { disabled: disabled === true }]">
    <ToolButton :icon="icon" :title="title" :disabled="disabled" @click="toggle" />
    <Teleport to="body">
      <PopupMenu v-if="anchor !== undefined" :items="items" :anchor="anchor" @close="close" />
    </Teleport>
  </span>
</template>

<style scoped>
.menu-button {
  position: relative;
  display: inline-flex;
  flex: none;
}
/* 选单的小三角：右下角一个直角朝右下的三角形，和图标同色；不挡点击。 */
.menu-button::after {
  content: "";
  position: absolute;
  right: 2px;
  bottom: 2px;
  border-left: 4px solid transparent;
  border-bottom: 4px solid var(--vscode-icon-foreground);
  pointer-events: none;
}
.menu-button.disabled::after {
  opacity: 0.4;
}
</style>
