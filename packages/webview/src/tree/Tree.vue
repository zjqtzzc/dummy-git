<script setup lang="ts">
import { assertNever } from "@dummy-git/shared";
import { computed, onMounted, onUnmounted, ref } from "vue";
import type { IconRef } from "../logic/icons.js";
import {
  CheckState,
  checkState,
  flattenTree,
  leafIds,
  setExpanded,
  TreeKeyActionKind,
  type TreeNode,
  type TreeRow,
  treeKeyAction,
} from "../logic/tree/tree.js";
import { ROW_HEIGHT, renderRange, scrollIntoView } from "../logic/virtualList.js";
import Icon from "../ui/Icon.vue";

/**
 * 所有树共用的基础组件（`.notes/design/phase-2.md` 第一节），外观与交互照 VS Code 原生的树。
 *
 * 一行从左到右：缩进、箭头（没有下级时隐藏但占位）、复选框（可选）、图标（可选）、文字、说明（可选）、使用方插槽 `after`（可选）、
 * 右侧字母（可选）。
 * 行高固定 22px，虚拟滚动，只渲染看得见的行。
 *
 * 展开状态由使用方持有（`v-model:expanded`）：默认展开哪些、要不要存下来各不相同。
 * 这里只算出新的集合交回去，收起时连下面的节点一起收起也在这一步。
 *
 * 给了 `checked`（勾选的叶子 id）才画复选框，勾选状态同样由使用方持有：
 * 这里只发出 `check`（想把哪些叶子改成勾 / 不勾），上级的全选 / 半选由叶子推出来。
 */
const props = defineProps<{
  nodes: readonly TreeNode[];
  expanded: ReadonlySet<string>;
  checked?: ReadonlySet<string> | undefined;
}>();
const emit = defineEmits<{
  "update:expanded": [expanded: ReadonlySet<string>];
  /** 单击、上下键：选中的行。 */
  select: [node: TreeNode];
  /** 双击、回车落在叶子上：打开。 */
  activate: [node: TreeNode];
  /** 点了复选框：把这些叶子改成勾（`true`）或不勾。 */
  check: [ids: readonly string[], value: boolean];
}>();

/**
 * 留给使用方的个性化出口：`after` 插槽画在说明后面（比如分支树的 ahead / behind）。
 * 基础组件不认识里面是什么；不用它的树不受影响。
 */
const slots = defineSlots<{ after?(props: { node: TreeNode }): unknown }>();

const rows = computed(() => flattenTree(props.nodes, props.expanded));

/** 选中的节点 id。节点消失了就没有选中行，id 留着，再出现时还是选中的。 */
const selected = ref<string>();
const selectedIndex = computed(() => rows.value.findIndex((row) => row.node.id === selected.value));

const scroller = ref<HTMLElement>();
const scrollTop = ref(0);
const viewportHeight = ref(0);
const visible = computed(() => {
  const range = renderRange(scrollTop.value, viewportHeight.value, rows.value.length);
  const checked = props.checked;
  return rows.value.slice(range.start, range.end).map((row, i) => ({
    row,
    index: range.start + i,
    check:
      checked === undefined || row.node.uncheckable === true
        ? undefined
        : checkState(row.node, checked),
    icon: iconOf(row),
  }));
});

function onScroll(): void {
  if (scroller.value !== undefined) scrollTop.value = scroller.value.scrollTop;
}
const resizes = new ResizeObserver(() => {
  if (scroller.value !== undefined) viewportHeight.value = scroller.value.clientHeight;
});
onMounted(() => {
  if (scroller.value !== undefined) resizes.observe(scroller.value);
});
onUnmounted(() => resizes.disconnect());

/** 每层缩进 11px。 */
const INDENT = 11;
/** 缩进线画在父节点箭头的正中：箭头格左留白 3 + 箭头宽的一半 8。 */
const GUIDE_OFFSET = 3 + 8;

function toggle(row: TreeRow): void {
  if (row.expanded === undefined) return;
  emit("update:expanded", setExpanded(props.expanded, row.node, !row.expanded));
}

function select(index: number): void {
  const row = rows.value[index];
  if (row === undefined) return;
  selected.value = row.node.id;
  emit("select", row.node);
  if (scroller.value !== undefined) {
    scroller.value.scrollTop = scrollIntoView(index, scrollTop.value, viewportHeight.value);
  }
}

function rowAt(event: MouseEvent): number | undefined {
  if (!(event.target instanceof Element)) return undefined;
  const index = event.target.closest("[data-index]")?.getAttribute("data-index");
  return index === null || index === undefined ? undefined : Number(index);
}

/**
 * 单击：点在复选框上只切换勾选（全勾时全不勾，否则全勾），不选中、不展开；
 * 点在插槽上什么都不做（按钮自己处理，不能顺带选中或展开这一行）；
 * 点在别处选中这一行，可展开的节点同时展开 / 收起（VS Code 默认的单击展开）。
 */
function hit(event: MouseEvent, selector: string): boolean {
  return event.target instanceof Element && event.target.closest(selector) !== null;
}

function onClick(event: MouseEvent): void {
  const index = rowAt(event);
  const row = index === undefined ? undefined : rows.value[index];
  if (index === undefined || row === undefined) return;
  if (hit(event, ".check")) {
    if (props.checked !== undefined) {
      emit("check", leafIds(row.node), checkState(row.node, props.checked) !== CheckState.Checked);
    }
    return;
  }
  if (hit(event, ".after")) return;
  select(index);
  toggle(row);
}

function onDblclick(event: MouseEvent): void {
  // 连点两下复选框是勾了又取消，不是打开。插槽上的按钮也不是打开。
  if (hit(event, ".check") || hit(event, ".after")) return;
  const index = rowAt(event);
  const row = index === undefined ? undefined : rows.value[index];
  if (row !== undefined && row.expanded === undefined) emit("activate", row.node);
}

/** 右键：先选中那一行（同 VS Code 原生的树），菜单由 VS Code 按这一行的 `data-vscode-context` 弹出。 */
function onContextmenu(event: MouseEvent): void {
  const index = rowAt(event);
  if (index !== undefined && index !== selectedIndex.value) select(index);
}

/**
 * 鼠标按下不让行抢焦点，焦点交给树本身（同提交列表）：
 * 行是虚拟滚动渲染的，滚出范围就被删掉，焦点若在行上，行一删焦点就丢了。
 */
function onMousedown(event: MouseEvent): void {
  if (rowAt(event) === undefined) return;
  // 插槽里的按钮要自己呈现按下。取消这次按下的话，按钮的按下态不会出现。
  if (hit(event, ".after")) return;
  event.preventDefault();
  scroller.value?.focus();
}

function onKeydown(event: KeyboardEvent): void {
  const action = treeKeyAction(rows.value, selectedIndex.value, event.key);
  if (action === undefined) return;
  event.preventDefault();
  const row = rows.value[selectedIndex.value];
  switch (action.kind) {
    case TreeKeyActionKind.Select:
      select(action.index);
      return;
    case TreeKeyActionKind.Expand:
      if (row !== undefined) emit("update:expanded", setExpanded(props.expanded, row.node, action.open));
      return;
    case TreeKeyActionKind.Activate:
      if (row !== undefined) emit("activate", row.node);
      return;
    default:
      assertNever(action, "onKeydown");
  }
}

/** 复选框里画什么：勾、横杠、空。codicon 的类名，表放在用它的模块里（CLAUDE.md B.3）。 */
const CHECK_ICON: Readonly<Record<CheckState, string>> = {
  [CheckState.Checked]: "codicon-check",
  [CheckState.Mixed]: "codicon-dash",
  [CheckState.Unchecked]: "",
};

/** 行首的图标：展开着且有 `openedIcon` 时换成它。 */
function iconOf(row: TreeRow): IconRef | undefined {
  return row.expanded === true && row.node.openedIcon !== undefined
    ? row.node.openedIcon
    : row.node.icon;
}

/** 行的 DOM id，给 `aria-activedescendant` 用。 */
function rowId(index: number): string {
  return `tree-row-${index}`;
}
</script>

<template>
  <div
    ref="scroller"
    class="tree"
    data-vscode-context='{"preventDefaultContextMenuItems": true}'
    role="tree"
    tabindex="0"
    :aria-activedescendant="selectedIndex === -1 ? undefined : rowId(selectedIndex)"
    @scroll="onScroll"
    @mousedown="onMousedown"
    @click="onClick"
    @dblclick="onDblclick"
    @contextmenu="onContextmenu"
    @keydown="onKeydown"
  >
    <div :style="{ height: `${rows.length * ROW_HEIGHT}px`, position: 'relative' }">
      <div
        v-for="{ row, index, check, icon } in visible"
        :id="rowId(index)"
        :key="row.node.id"
        role="treeitem"
        :data-vscode-context="row.node.menu === undefined ? undefined : JSON.stringify(row.node.menu)"
        tabindex="-1"
        :aria-level="row.depth + 1"
        :aria-expanded="row.expanded"
        :aria-selected="index === selectedIndex"
        :data-index="index"
        :class="['row', { selected: index === selectedIndex }]"
        :style="{ top: `${index * ROW_HEIGHT}px`, paddingLeft: `${row.depth * INDENT}px` }"
      >
        <span
          v-for="level in row.depth"
          :key="level"
          class="guide"
          :style="{ left: `${(level - 1) * INDENT + GUIDE_OFFSET}px` }"
        />
        <span
          :class="[
            'twistie',
            'codicon',
            row.expanded === undefined ? '' : row.expanded ? 'codicon-chevron-down' : 'codicon-chevron-right',
          ]"
        />
        <span v-if="check !== undefined" :class="['check', 'codicon', CHECK_ICON[check]]" />
        <span v-if="icon !== undefined" class="icon" :style="{ color: row.node.iconColor }">
          <Icon :icon="icon" />
        </span>
        <span :class="['label', { bold: row.node.bold }]" :style="{ color: row.node.color }">{{
          row.node.label
        }}</span>
        <span v-if="row.node.description !== undefined" class="description">{{
          row.node.description
        }}</span>
        <span v-if="slots.after !== undefined" :class="['after', { end: row.node.alignEnd }]">
          <slot name="after" :node="row.node" />
        </span>
        <span v-if="row.node.decoration !== undefined" class="decoration" :style="{ color: row.node.color }">{{
          row.node.decoration
        }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
/*
 * 尺寸与配色照 VS Code 原生的树（资源管理器），缩进按我们自己的：行高 22px、每层缩进 11px、箭头格与复选框格都是 3 + 16 + 3、
 * 图标 16px 右留 6px；选中、悬停、焦点框、缩进线都用主题的 list / tree 变量。
 */
.tree {
  height: 100%;
  overflow-y: auto;
  outline: none;
  user-select: none;
}
.row {
  position: absolute;
  left: 0;
  right: 0;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  height: 22px;
  padding-right: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.row:hover {
  background: var(--vscode-list-hoverBackground);
  color: var(--vscode-list-hoverForeground);
}
.row.selected {
  background: var(--vscode-list-inactiveSelectionBackground);
  color: var(--vscode-list-inactiveSelectionForeground);
}
.tree:focus .row.selected {
  background: var(--vscode-list-activeSelectionBackground);
  color: var(--vscode-list-activeSelectionForeground);
  outline: 1px solid var(--vscode-list-focusOutline);
  outline-offset: -1px;
}
/* 缩进线：鼠标在树上时才显示（VS Code 默认的 onHover）。 */
.guide {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--vscode-tree-indentGuidesStroke);
  opacity: 0;
  transition: opacity 0.1s;
}
.tree:hover .guide {
  opacity: 0.4;
}
.twistie {
  flex: none;
  width: 16px;
  padding-left: 3px;
  padding-right: 3px;
  font-size: 16px;
  color: var(--vscode-icon-foreground);
}
.check {
  box-sizing: border-box;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin: 0 3px;
  font-size: 14px;
  border: 1px solid var(--vscode-checkbox-border);
  border-radius: 3px;
  background: var(--vscode-checkbox-background);
  color: var(--vscode-checkbox-foreground);
}
.icon {
  flex: none;
  display: flex;
  margin-right: 6px;
}
.label {
  overflow: hidden;
  text-overflow: ellipsis;
}
.bold {
  font-weight: 600;
}
.description {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-left: 0.5em;
  font-size: 0.9em;
  opacity: 0.7;
}
.after {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: 0.5em;
  font-size: 0.9em;
}
.after.end {
  margin-left: auto;
}
.decoration {
  flex: none;
  margin-left: auto;
  padding-left: 6px;
  font-size: 0.9em;
}
</style>
