<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue";
import {
  clickPopupItem,
  type OpenPath,
  openLevels,
  PopupClick,
  type PopupItem,
  pathAfterClick,
  planHover,
} from "../logic/popupMenu.js";
import { PopupSide, type Rect } from "../logic/popupPlacement.js";
import PopupList from "./PopupList.vue";

/**
 * 浮层选单：一级选单贴着 `anchor` 往下弹，开着的二级选单逐级往右弹，每一级是一个 `PopupList`，平铺画出来。
 * 管开着哪一串（`logic/popupMenu.ts` 的 `planHover` 等）和那一个等着的计时器；
 * 点外面、Esc、失去焦点收起由打开它的按钮管。
 */
const props = defineProps<{ items: readonly PopupItem[]; anchor: Rect }>();
const emit = defineEmits<{ close: [] }>();

const path = ref<OpenPath>([]);
/** 第 k 个是打开第 k+1 级的那一行，第 k+1 级从它旁边弹出。和 `path` 一样长。 */
const rows = ref<readonly Rect[]>([]);

const levels = computed(() =>
  openLevels(props.items, path.value).map((items, level) => ({
    items,
    anchor: level === 0 ? props.anchor : rows.value[level - 1],
    side: level === 0 ? PopupSide.Below : PopupSide.Right,
    openIndex: path.value[level],
    // 换了打开的那一项，下一级重新量尺寸、重新定位。
    key: path.value.slice(0, level).join("/"),
  })),
);

let pending: ReturnType<typeof setTimeout> | undefined;
function cancel(): void {
  if (pending !== undefined) clearTimeout(pending);
  pending = undefined;
}
onUnmounted(cancel);

/**
 * 停在或点了第 `level` 级的一行之后改成 `next`：前 `level` 级不变，
 * `next` 比它长就是从这一行新开了一级，记下这一行。
 */
function open(next: OpenPath, level: number, rect: Rect): void {
  const kept = rows.value.slice(0, level);
  rows.value = next.length > level ? [...kept, rect] : kept;
  path.value = next;
}

function onHover(level: number, index: number, rect: Rect): void {
  const item = levels.value[level]?.items[index];
  if (item === undefined) return;
  cancel();
  const plan = planHover(path.value, level, index, item);
  if (plan === undefined) return;
  pending = setTimeout(() => {
    pending = undefined;
    open(plan.path, level, rect);
  }, plan.delay);
}

function onClick(level: number, index: number, rect: Rect): void {
  const item = levels.value[level]?.items[index];
  if (item === undefined) return;
  cancel();
  open(pathAfterClick(path.value, level, index, item), level, rect);
  if (clickPopupItem(item) === PopupClick.Close) emit("close");
}


</script>

<template>
  <PopupList
    v-for="(level, index) in levels"
    :key="level.key"
    :items="level.items"
    :anchor="level.anchor ?? anchor"
    :side="level.side"
    :open-index="level.openIndex"
    @hover="(i, rect) => onHover(index, i, rect)"
    @click="(i, rect) => onClick(index, i, rect)"
    @leave="cancel"
  />
</template>
