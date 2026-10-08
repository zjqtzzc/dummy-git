<script setup lang="ts">
import type { Commit } from "@dummy-git/shared";
import { computed, onMounted, onUnmounted, ref } from "vue";
import { formatTime } from "../logic/utils/time.js";
import {
  keepRowInPlace,
  ROW_HEIGHT,
  type RowRange,
  renderRange,
  scrollIntoView,
  scrollToCenter,
} from "../logic/virtualList.js";

/**
 * 中间的提交列表：固定三列 Message / Author / Date，虚拟滚动。
 * 只管显示和滚动；取数由父组件按 `visible` 事件去做。
 */
const props = defineProps<{
  /** 骨架的顺序。滚动条代表全部这些行。 */
  hashes: readonly string[];
  /** 已经取到的详情。没取到的行显示占位。 */
  details: ReadonlyMap<string, Commit>;
  selected: string | undefined;
  /** 「现在」，秒。父组件定时刷新它，相对时间才会走。 */
  now: number;
}>();

const emit = defineEmits<{
  select: [hash: string];
  /** 可见范围变了（滚动、尺寸变化、行数变化后）。 */
  visible: [range: RowRange];
}>();

const scroller = ref<HTMLElement>();
const scrollTop = ref(0);
const viewportHeight = ref(0);

const range = computed(() =>
  renderRange(scrollTop.value, viewportHeight.value, props.hashes.length),
);
const rows = computed(() =>
  props.hashes.slice(range.value.start, range.value.end).map((hash, i) => ({
    hash,
    index: range.value.start + i,
    commit: props.details.get(hash),
  })),
);

function subject(message: string): string {
  const end = message.indexOf("\n");
  return end === -1 ? message : message.slice(0, end);
}

function onScroll(): void {
  if (scroller.value === undefined) return;
  scrollTop.value = scroller.value.scrollTop;
  emit("visible", range.value);
}

/**
 * 点击由列表统一处理（行上带 `data-hash`），焦点留在列表本身，用 `aria-activedescendant`
 * 指向选中行——listbox 的标准写法，行不单独挂事件、不单独获得焦点。
 */
function onClick(event: MouseEvent): void {
  if (!(event.target instanceof Element)) return;
  const hash = event.target.closest("[data-hash]")?.getAttribute("data-hash");
  if (hash !== null && hash !== undefined) emit("select", hash);
}

/**
 * 鼠标按下不让行抢焦点，焦点交给列表本身。
 *
 * 行是虚拟滚动渲染的，滚出范围就被删掉；焦点若在行上，行一删焦点就丢了，
 * 之后按键再也到不了列表。行上也就不会出现焦点框。
 */
function onMousedown(event: MouseEvent): void {
  // 只管按在行上的情况；按在滚动条上要让浏览器照常拖动。
  if (!(event.target instanceof Element) || event.target.closest("[data-hash]") === null) return;
  event.preventDefault();
  scroller.value?.focus();
}

/** 行的 DOM id，给 `aria-activedescendant` 用。 */
function optionId(hash: string): string {
  return `commit-${hash}`;
}

/** 上下键：选中相邻一行并让它出现在视口里。 */
function onKeydown(event: KeyboardEvent): void {
  const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
  if (step === 0) return;
  event.preventDefault();
  const current = props.selected === undefined ? -1 : props.hashes.indexOf(props.selected);
  const next = Math.min(props.hashes.length - 1, Math.max(0, current + step));
  const hash = props.hashes[next];
  if (hash === undefined) return;
  emit("select", hash);
  scrollTo(scrollIntoView(next, scrollTop.value, viewportHeight.value));
}

function scrollTo(top: number): void {
  if (scroller.value === undefined) return;
  scroller.value.scrollTop = top;
  onScroll();
}

const resizes = new ResizeObserver(() => {
  if (scroller.value === undefined) return;
  viewportHeight.value = scroller.value.clientHeight;
  emit("visible", range.value);
});
onMounted(() => {
  if (scroller.value !== undefined) resizes.observe(scroller.value);
});
onUnmounted(() => resizes.disconnect());

defineExpose({
  /** 让第 `row` 行居中（看得见就不动）。 */
  reveal(row: number): void {
    scrollTo(scrollToCenter(row, scrollTop.value, viewportHeight.value));
  },
  /** 刷新后选中行从 `oldRow` 挪到了 `newRow`：让它停在屏幕上原来的位置。 */
  shift(oldRow: number, newRow: number): void {
    scrollTo(keepRowInPlace(oldRow, newRow, scrollTop.value));
  },
});
</script>

<template>
  <div class="commit-list">
    <div class="columns header">
      <span>Message</span>
      <span>Author</span>
      <span>Date</span>
    </div>
    <div
      ref="scroller"
      class="scroller"
      role="listbox"
      tabindex="0"
      aria-label="Commits"
      :aria-activedescendant="selected === undefined ? undefined : optionId(selected)"
      @scroll="onScroll"
      @mousedown="onMousedown"
      @click="onClick"
      @keydown="onKeydown"
    >
      <div :style="{ height: `${hashes.length * ROW_HEIGHT}px`, position: 'relative' }">
        <div
          v-for="row in rows"
          :key="row.hash"
          :id="optionId(row.hash)"
          role="option"
          tabindex="-1"
          :data-hash="row.hash"
          :aria-selected="row.hash === selected"
          :class="['columns', 'row', { selected: row.hash === selected }]"
          :style="{ top: `${row.index * ROW_HEIGHT}px`, height: `${ROW_HEIGHT}px` }"
        >
          <template v-if="row.commit !== undefined">
            <span class="cell">{{ subject(row.commit.message) }}</span>
            <span class="cell dim">{{ row.commit.author.name }}</span>
            <span class="cell dim">{{ formatTime(row.commit.author.at, now) }}</span>
          </template>
          <template v-else>
            <span class="cell placeholder" />
            <span class="cell placeholder" />
            <span class="cell placeholder" />
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.commit-list {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.columns {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 12em 9.5em;
  gap: 12px;
  padding: 0 8px;
  align-items: center;
}
.header {
  flex: none;
  height: 22px;
  font-weight: 600;
  border-bottom: 1px solid var(--vscode-panel-border);
}
.scroller {
  flex: 1;
  overflow-y: auto;
  outline: none;
}
.row {
  position: absolute;
  left: 0;
  right: 0;
  cursor: default;
}
.row:hover {
  background: var(--vscode-list-hoverBackground);
}
.row.selected {
  background: var(--vscode-list-activeSelectionBackground);
  color: var(--vscode-list-activeSelectionForeground);
}
.cell {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.placeholder {
  height: 0.8em;
  border-radius: 2px;
  background: var(--vscode-editorWidget-border);
  opacity: 0.4;
}
</style>
