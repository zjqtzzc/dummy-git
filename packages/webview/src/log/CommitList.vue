<script setup lang="ts">
import { assertNever, type Commit, MenuContextKey, RefKind } from "@dummy-git/shared";
import { computed, onMounted, onUnmounted, ref } from "vue";
import { codicon, type IconRef, IconSize } from "../logic/icons.js";
import { ColumnHandle, type Columns, resizeColumns, restoreColumns } from "../logic/log/columns.js";
import { commitMenuContext } from "../logic/log/commitMenu.js";
import type { Graph } from "../logic/log/graph/types.js";
import type { RefLabel } from "../logic/log/refLabels.js";
import { containerMenuContext } from "../logic/menuContext.js";
import {
  clickRow,
  contextMenuOn,
  type Selection,
  selectAll,
  stepCursor,
} from "../logic/selection.js";
import { formatTime } from "../logic/utils/time.js";
import {
  keepRowInPlace,
  ROW_HEIGHT,
  type RowRange,
  renderRange,
  scrollIntoView,
  scrollToCenter,
} from "../logic/virtualList.js";
import Icon from "../ui/Icon.vue";
import { viewState } from "../vscodeApi.js";
import GraphCell, { graphWidth } from "./GraphCell.vue";

/**
 * 中间的提交列表：固定三列 Message / Author / Date，虚拟滚动。
 * 只管显示和滚动；取数由父组件按 `visible` 事件去做。
 */
const props = defineProps<{
  /** 骨架的顺序。滚动条代表全部这些行。 */
  hashes: readonly string[];
  /** 已经取到的详情。没取到的行显示占位。 */
  details: ReadonlyMap<string, Commit>;
  /** 选中由父组件持有（`v-model:selection`），规则见 `logic/selection.ts`。 */
  selection: Selection;
  /** 「现在」，秒。父组件定时刷新它，相对时间才会走。 */
  now: number;
  /** 仓库根。菜单命令拿它拼协议参数。还没打开仓库时缺席。 */
  repo: string | undefined;
  /** 提交图，`rows` 与 `hashes` 同一个下标。缺席时不画图。 */
  graph: Graph | undefined;
  /** 提交 hash → 这个提交上的 ref 标签。 */
  labels: ReadonlyMap<string, readonly RefLabel[]>;
  /** 能改说明的提交，右键菜单才有 `Edit Commit Message…`。 */
  rewordable: ReadonlySet<string>;
}>();

const emit = defineEmits<{
  "update:selection": [selection: Selection];
  /** 按了复制快捷键（Ctrl+C / Cmd+C），`hash` 是光标所在的那条。复制什么由父组件定。 */
  copy: [hash: string];
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
  props.hashes.slice(range.value.start, range.value.end).map((hash, i) => {
    const index = range.value.start + i;
    return {
      hash,
      index,
      commit: props.details.get(hash),
      graph: graphOf(index),
      labels: props.labels.get(hash) ?? [],
    };
  }),
);

function labelIcon(kind: RefKind): IconRef {
  switch (kind) {
    case RefKind.Head:
      return codicon("warning");
    case RefKind.LocalBranch:
      return codicon("git-branch");
    case RefKind.RemoteBranch:
      return codicon("cloud");
    case RefKind.Tag:
      return codicon("tag");
    default:
      return assertNever(kind, "labelIcon");
  }
}

/**
 * 标签放不下时从后往前压：越靠后收缩系数越大，前面的名字留到最后。
 * 指数封顶，免得系数大到浮点溢出；第 5 个以后一起压。
 */
function shrinkOf(index: number): number {
  return 100 ** Math.min(index, 4);
}

/** 图标颜色：扫一眼就分得出当前分支、本地、远程、tag；detached HEAD 用警告色。 */
function labelColor(label: RefLabel): string {
  if (label.current) return "var(--vscode-charts-yellow)";
  switch (label.kind) {
    case RefKind.Head:
      return "var(--vscode-editorWarning-foreground)";
    case RefKind.LocalBranch:
      return "var(--vscode-charts-green)";
    case RefKind.RemoteBranch:
      return "var(--vscode-charts-purple)";
    case RefKind.Tag:
      return "var(--vscode-descriptionForeground)";
    default:
      return assertNever(label.kind, "labelColor");
  }
}

/** 一行的图，以及要给 Message 留出的宽度。 */
function graphOf(index: number) {
  const row = props.graph?.rows.at(index);
  if (props.graph === undefined || row === undefined) return undefined;
  return { row, base: props.graph.base, width: graphWidth(row, props.graph.base) };
}

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
 * 指向光标所在行——listbox 的标准写法，行不单独挂事件、不单独获得焦点。
 */
function hashAt(event: MouseEvent): string | undefined {
  if (!(event.target instanceof Element)) return undefined;
  return event.target.closest("[data-hash]")?.getAttribute("data-hash") ?? undefined;
}

/** 点一行：Ctrl（Mac 上 Cmd）加选减选，Shift 选一段。Mac 上 Ctrl+单击是右键，走不到这里。 */
function onClick(event: MouseEvent): void {
  const hash = hashAt(event);
  if (hash === undefined) return;
  emit(
    "update:selection",
    clickRow(props.selection, props.hashes, hash, {
      toggle: event.ctrlKey || event.metaKey,
      range: event.shiftKey,
    }),
  );
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

/**
 * 右键：点在已选中的行上选中不变，点在别的行上先改成只选它；
 * 再把这次的菜单上下文写到列表容器上（为什么写在容器上见 `containerMenuContext`）。
 * 出现哪些菜单项、各自作用于哪些提交，由 `commitMenuContext` 按选中算。点在空白处不出菜单项。
 */
function onContextmenu(event: MouseEvent): void {
  const hash = hashAt(event);
  const selection = hash === undefined ? props.selection : contextMenuOn(props.selection, hash);
  if (selection !== props.selection) emit("update:selection", selection);
  if (!(event.currentTarget instanceof HTMLElement)) return;
  const picked = props.hashes.filter((h) => selection.ids.has(h));
  event.currentTarget.setAttribute(
    "data-vscode-context",
    containerMenuContext(
      hash === undefined || props.repo === undefined
        ? undefined
        : { [MenuContextKey.Repo]: props.repo, ...commitMenuContext(picked, props.rewordable) },
    ),
  );
}

/**
 * 上下键（Shift 时选一段）：挪到相邻一行并让它出现在视口里。Ctrl+A：全选。
 * 复制快捷键：复制光标所在的那条。
 */
function onKeydown(event: KeyboardEvent): void {
  const command = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  if (command && key === "c") {
    if (props.selection.cursor === undefined) return;
    event.preventDefault();
    emit("copy", props.selection.cursor);
    return;
  }
  if (command && key === "a") {
    // 不拦的话浏览器会选中整页的文字。
    event.preventDefault();
    emit("update:selection", selectAll(props.selection, props.hashes));
    return;
  }
  const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
  if (step === 0) return;
  event.preventDefault();
  const selection = stepCursor(props.selection, props.hashes, step, event.shiftKey);
  if (selection === props.selection || selection.cursor === undefined) return;
  emit("update:selection", selection);
  const row = props.hashes.indexOf(selection.cursor);
  scrollTo(scrollIntoView(row, scrollTop.value, viewportHeight.value));
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
/**
 * 列表有焦点时不许出现文字选区。Mac 上 Cmd+A 拦了按键也照样把整页文字选上（调试窗口实测），
 * 选区不是页面自己选的，拦不住来路，只能在它出现时清掉。
 */
function clearTextSelection(): void {
  if (scroller.value !== undefined && document.activeElement === scroller.value) {
    document.getSelection()?.removeAllRanges();
  }
}
onMounted(() => {
  if (scroller.value !== undefined) resizes.observe(scroller.value);
  document.addEventListener("selectionchange", clearTextSelection);
});
onUnmounted(() => {
  resizes.disconnect();
  document.removeEventListener("selectionchange", clearTextSelection);
});

/** 拖过的列宽，存进 `viewState`；没拖过时 CSS 用 em 默认值。 */
const columns = ref<Columns | undefined>(restoreColumns(viewState.read("columns")));
const columnStyle = computed(() =>
  columns.value === undefined
    ? {}
    : { "--author": `${columns.value.author}px`, "--date": `${columns.value.date}px` },
);
const authorHeader = ref<HTMLElement>();
const dateHeader = ref<HTMLElement>();

/** 按下分界线：从此刻表头的实际宽度起算（没拖过时是 em 换算出的像素），松手时存回去。 */
function startResize(handle: ColumnHandle, event: PointerEvent): void {
  if (authorHeader.value === undefined || dateHeader.value === undefined) return;
  const target = event.currentTarget;
  if (!(target instanceof HTMLElement)) return;
  const start: Columns = {
    author: authorHeader.value.getBoundingClientRect().width,
    date: dateHeader.value.getBoundingClientRect().width,
  };
  const x = event.clientX;
  target.setPointerCapture(event.pointerId);
  const move = (e: PointerEvent) => {
    columns.value = resizeColumns(start, handle, e.clientX - x);
  };
  const end = () => {
    target.removeEventListener("pointermove", move);
    target.removeEventListener("pointerup", end);
    if (columns.value !== undefined) viewState.write("columns", columns.value);
  };
  target.addEventListener("pointermove", move);
  target.addEventListener("pointerup", end);
}

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
  <div class="commit-list" :style="columnStyle">
    <div class="columns header">
      <span>Message</span>
      <span ref="authorHeader" class="resizable">
        <span class="resize-handle" @pointerdown="startResize(ColumnHandle.Author, $event)" />
        Author
      </span>
      <span ref="dateHeader" class="resizable">
        <span class="resize-handle" @pointerdown="startResize(ColumnHandle.Date, $event)" />
        Date
      </span>
    </div>
    <div
      ref="scroller"
      class="scroller"
      role="listbox"
      tabindex="0"
      aria-label="Commits"
      aria-multiselectable="true"
      :aria-activedescendant="selection.cursor === undefined ? undefined : optionId(selection.cursor)"
      @scroll="onScroll"
      @mousedown="onMousedown"
      @click="onClick"
      @contextmenu="onContextmenu"
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
          :aria-selected="selection.ids.has(row.hash)"
          :class="['columns', 'row', { selected: selection.ids.has(row.hash) }]"
          :style="{ top: `${row.index * ROW_HEIGHT}px`, height: `${ROW_HEIGHT}px` }"
        >
          <GraphCell v-if="row.graph !== undefined" :row="row.graph.row" :base="row.graph.base" />
          <span class="cell message" :style="{ paddingLeft: `${row.graph?.width ?? 0}px` }">
            <span v-if="row.commit !== undefined" class="subject">{{ subject(row.commit.message) }}</span>
            <span v-else class="subject placeholder" />
            <span v-if="row.labels.length > 0" class="labels">
              <span
                v-for="(label, i) in row.labels"
                :key="i"
                class="label"
                :style="{ flexShrink: shrinkOf(i) }"
                :title="label.title"
              >
                <span class="label-icon" :style="{ color: labelColor(label) }">
                  <Icon :icon="labelIcon(label.kind)" :size="IconSize.Inline" />
                </span>
                <span class="label-name">{{ label.name }}</span>
              </span>
            </span>
          </span>
          <template v-if="row.commit !== undefined">
            <span class="cell dim">{{ row.commit.author.name }}</span>
            <span class="cell dim">{{ formatTime(row.commit.author.at, now) }}</span>
          </template>
          <template v-else>
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
  grid-template-columns: minmax(0, 1fr) var(--author, 8em) var(--date, 9.5em);
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
.resizable {
  position: relative;
}
/* 分界线抓手：骑在列间 12px 的空隙正中。 */
.resize-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  left: -9px;
  width: 6px;
  cursor: col-resize;
  touch-action: none;
}
/* 表头里一直显示的分界线（同 IDEA），颜色同表头底边。 */
.resize-handle::before {
  content: "";
  position: absolute;
  top: 4px;
  bottom: 4px;
  left: 50%;
  border-left: 1px solid var(--vscode-panel-border);
}
.scroller {
  flex: 1;
  overflow-y: auto;
  outline: none;
  user-select: none;
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
/* 说明文字在左、标签靠右。标签最多占「一半」与「减去 80px」中较大的那个，说明文字至少留 80px。 */
.message {
  display: flex;
  align-items: center;
  gap: 6px;
}
.subject {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.labels {
  flex: none;
  display: flex;
  gap: 8px;
  max-width: max(50%, 100% - 80px);
  overflow: hidden;
}
.label {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  /* 名字压没了只剩图标（Inline 图标 12px），不会盖到旁边的标签上。 */
  min-width: 12px;
  overflow: hidden;
  font-size: 0.9em;
}
.label-icon {
  display: inline-flex;
  flex: none;
}
.label-name {
  overflow: hidden;
  text-overflow: ellipsis;
}
.placeholder {
  display: block;
  height: 0.8em;
  border-radius: 2px;
  background: var(--vscode-editorWidget-border);
  opacity: 0.4;
}
</style>
