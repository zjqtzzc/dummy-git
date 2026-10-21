<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { codicon, IconSize } from "../logic/icons.js";
import { type PopupItem, PopupItemKind } from "../logic/popupMenu.js";
import { type Placement, type PopupSide, placePopup, type Rect } from "../logic/popupPlacement.js";
import Icon from "./Icon.vue";

/**
 * 浮层选单里的一级：贴着 `anchor` 弹出，位置由 `placePopup` 算（上下左右都不超出 webview）。
 * 只画、只把鼠标停在哪一项、点了哪一项交上去；开着哪一串、点了之后怎么样由 `PopupMenu` 管。
 * 先按自然尺寸画在看不见的地方量出大小，再挪到算好的位置。
 */
const props = defineProps<{
  items: readonly PopupItem[];
  anchor: Rect;
  side: PopupSide;
  /** 下一级开着时，是哪一项打开的：这一项保持高亮。 */
  openIndex: number | undefined;
}>();
const emit = defineEmits<{
  /** 鼠标停到一项上；`rect` 是这一行，下一级从它旁边弹出。 */
  hover: [index: number, rect: Rect];
  click: [index: number, rect: Rect];
  /**
   * 鼠标离开这一级（进了下一级、或出了选单）：等着的那次作废。
   * 斜着移进二级选单时擦过了同级别的项，要关它的那次不再关；停满之前就移走了，要开的那次不再开（同 VS Code）。
   */
  leave: [];
}>();

const box = ref<HTMLElement>();
const placement = ref<Placement>();

onMounted(() => {
  if (box.value === undefined) return;
  placement.value = placePopup(
    props.anchor,
    props.side,
    { width: box.value.offsetWidth, height: box.value.offsetHeight },
    { width: window.innerWidth, height: window.innerHeight },
  );
});

const style = computed(() =>
  placement.value === undefined
    ? { left: "0px", top: "0px", visibility: "hidden" as const }
    : {
        left: `${placement.value.left}px`,
        top: `${placement.value.top}px`,
        ...(placement.value.maxHeight === undefined
          ? {}
          : { maxHeight: `${placement.value.maxHeight}px` }),
      },
);

function rowRect(event: MouseEvent): Rect {
  return event.currentTarget instanceof Element
    ? event.currentTarget.getBoundingClientRect()
    : { left: 0, top: 0, width: 0, height: 0 };
}
</script>

<template>
  <div ref="box" class="popup" :style="style" @contextmenu.prevent @mouseleave="emit('leave')">
    <template v-for="(item, index) in items" :key="index">
      <div v-if="item.kind === PopupItemKind.Separator" :class="['separator', { first: index === 0 }]">
        <span v-if="item.label !== undefined" class="section">{{ item.label }}</span>
      </div>
      <div
        v-else
        :class="['item', { disabled: item.disabled === true, open: index === openIndex }]"
        @mouseenter="emit('hover', index, rowRect($event))"
        @click="emit('click', index, rowRect($event))"
      >
        <span class="check">
          <Icon
            v-if="item.kind === PopupItemKind.Toggle && item.checked"
            :icon="codicon('check')"
            :size="IconSize.Inline"
          />
        </span>
        <span class="label">{{ item.label }}</span>
        <span class="more">
          <Icon
            v-if="item.kind === PopupItemKind.Submenu"
            :icon="codicon('chevron-right')"
            :size="IconSize.Inline"
          />
        </span>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* 颜色、阴影照 VS Code 自己的菜单（`menu.*`、`widget.shadow`）。 */
.popup {
  position: fixed;
  z-index: 100;
  min-width: 160px;
  overflow-y: auto;
  padding: 4px 0;
  border: 1px solid var(--vscode-menu-border, transparent);
  border-radius: 5px;
  background: var(--vscode-menu-background);
  color: var(--vscode-menu-foreground);
  box-shadow: 0 2px 8px var(--vscode-widget-shadow);
  user-select: none;
}
.item {
  display: flex;
  align-items: center;
  height: 24px;
  margin: 0 4px;
  padding: 0 6px 0 2px;
  border-radius: 3px;
  white-space: nowrap;
  cursor: default;
}
.item:hover:not(.disabled),
.item.open {
  background: var(--vscode-menu-selectionBackground);
  color: var(--vscode-menu-selectionForeground);
}
.item.disabled {
  opacity: 0.4;
}
/* 勾的那一列每行都占着，有勾没勾的文字都对齐。 */
.check,
.more {
  display: flex;
  justify-content: center;
  width: 20px;
  flex: none;
}
.label {
  flex: 1;
}
.separator {
  margin: 4px 10px;
  border-top: 1px solid var(--vscode-menu-separatorBackground);
}
.separator.first {
  margin-top: 0;
  border-top: none;
}
.section {
  display: block;
  padding-top: 4px;
  color: var(--vscode-descriptionForeground);
  font-size: 0.9em;
}
</style>
