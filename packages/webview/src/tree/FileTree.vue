<script setup lang="ts">
import { DiffOpenMode } from "@dummy-git/shared";
import { computed, ref, watch } from "vue";
import type { MenuArgs, MenuViews } from "../logic/menuItems.js";
import {
  buildFileTree,
  checkedIds,
  type FileGroup,
  type FileRow,
  filesById,
  toTreeNodes,
} from "../logic/tree/fileTree.js";
import { branchIds, type TreeNode, viewsOfIds } from "../logic/tree/tree.js";
import { useLightTheme } from "../ui/lightTheme.js";
import Tree from "./Tree.vue";

/**
 * 所有文件树共用的一层，建在基础树 `Tree.vue` 上：
 * 分组的文件整理成树、配上 Seti 图标与改动字母；新出现的目录默认展开；
 * 双击或回车打开 diff，单击或上下键时 diff 跟随（真正开不开由扩展侧 `vscode/diff.ts` 判断）。
 * 只认 `FileEntry`，左右各是什么由使用方决定。
 * 给了 `checked`（勾选的路径）才有复选框；勾选状态由使用方持有，这里只转发 `check`。
 * 给了 `menu` 才有右键菜单：选中换成文件（`FileRow`，哪一组的哪个）交给它，目录与组是 `null`。
 */
const props = defineProps<{
  groups: readonly FileGroup[];
  checked?: ReadonlySet<string> | undefined;
  /** 按目录分组（默认）；为假时文件平铺在组下面（View Options 的 `Group By` → `Directory`）。 */
  byDirectory?: boolean;
  menu?:
    | ((views: MenuViews<FileRow | null>) => Readonly<Record<string, string | MenuArgs>>)
    | undefined;
}>();
const emit = defineEmits<{
  open: [row: FileRow, mode: DiffOpenMode];
  /** 想把这些路径改成勾（`true`）或不勾。 */
  check: [paths: readonly string[], value: boolean];
  /** 复制快捷键：选中的行显示的文字，一行一个（文件名、目录名、组的标题）。 */
  copy: [text: string];
  /**
   * 选中（两种看法），换成了文件（哪一组的哪个），目录与组是 `null`。工具栏按钮用。
   * 文件列表一变就按当前的树重新报一次：刚撤掉的文件不再算在选中里。
   */
  select: [views: MenuViews<FileRow | null>];
}>();
const slots = defineSlots<{
  after?(props: { node: TreeNode }): unknown;
}>();

const light = useLightTheme();
const fileNodes = computed(() => buildFileTree(props.groups, props.byDirectory !== false));
const nodes = computed(() => toTreeNodes(fileNodes.value, light.value));
/** 节点 id → 文件。节点 id 带着组（`scopedId`），对外一律用路径。 */
const byId = computed(() => filesById(fileNodes.value));
/** 勾选按路径记，基础树按叶子 id 画：同一路径在几组里各有一行时都画成勾上。 */
const checkedNodes = computed(() =>
  props.checked === undefined ? undefined : checkedIds(byId.value, props.checked),
);

/**
 * 展开状态。新出现的目录（第一次见到的 id）默认展开；用户收起过的、刷新后还在的保持收起。
 */
const expanded = ref<ReadonlySet<string>>(new Set());
let known = new Set<string>();
watch(
  nodes,
  (current) => {
    const ids = branchIds(current);
    const next = new Set(expanded.value);
    for (const id of ids) if (!known.has(id)) next.add(id);
    known = new Set(ids);
    expanded.value = next;
  },
  { immediate: true },
);

/**
 * 上次跟随的那一行（节点 id）：同一行重复选中时不再跟，免得 diff 反复打开。
 * 按行不按路径：同一路径在两组里各有一行时，换到另一行要换 diff。
 */
let followed: string | undefined;
// 文件列表整个换了（比如换了一条提交）：同名文件也要重新跟。
watch(
  () => props.groups,
  () => {
    followed = undefined;
  },
);

defineExpose({
  /** 全部展开 / 全部收起（Commit 面板工具栏）。 */
  expandAll(): void {
    expanded.value = new Set(branchIds(nodes.value));
  },
  collapseAll(): void {
    expanded.value = new Set();
  },
});

/** 点中的节点 id（看得见的选中行）。 */
const selectedIds = ref<readonly string[]>([]);
watch([selectedIds, nodes], ([ids, current]) => {
  const views = viewsOfIds(current, ids);
  const toRow = (node: TreeNode): FileRow | null => byId.value.get(node.id) ?? null;
  emit("select", { exact: views.exact.map(toRow), expanded: views.expanded.map(toRow) });
});

/** diff 跟随：只在恰好选中一个文件时（同提交列表的右栏）。 */
function onSelect({ exact }: MenuViews<TreeNode>): void {
  selectedIds.value = exact.map((node) => node.id);
  const [node] = exact;
  if (exact.length !== 1 || node === undefined || node.id === followed) return;
  const row = byId.value.get(node.id);
  if (row === undefined) return;
  followed = node.id;
  emit("open", row, DiffOpenMode.Follow);
}

/** 右键菜单：树节点换回文件，目录与组是 `null`。 */
const treeMenu = computed(() => {
  const menu = props.menu;
  if (menu === undefined) return undefined;
  const toRow = (node: TreeNode): FileRow | null => byId.value.get(node.id) ?? null;
  return (views: MenuViews<TreeNode>) =>
    menu({ exact: views.exact.map(toRow), expanded: views.expanded.map(toRow) });
});

/** 基础树给的是叶子 id，交出去换成路径。 */
function onCheck(ids: readonly string[], value: boolean): void {
  const paths = ids.flatMap((id) => {
    const row = byId.value.get(id);
    return row === undefined ? [] : [row.entry.path];
  });
  emit("check", [...new Set(paths)], value);
}

function onActivate(node: TreeNode): void {
  const row = byId.value.get(node.id);
  if (row === undefined) return;
  followed = node.id;
  emit("open", row, DiffOpenMode.Open);
}
</script>

<template>
  <Tree
    v-model:expanded="expanded"
    :nodes="nodes"
    :checked="checkedNodes"
    :menu="treeMenu"
    @select="onSelect"
    @activate="onActivate"
    @check="onCheck"
    @copy="(text) => emit('copy', text)"
  >
    <template v-if="slots.after" #after="slotProps">
      <slot name="after" v-bind="slotProps" />
    </template>
  </Tree>
</template>
