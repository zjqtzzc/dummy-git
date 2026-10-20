<script setup lang="ts">
import type { Ref } from "@dummy-git/shared";
import { computed, ref, watch } from "vue";
import {
  type BranchNode,
  branchFilterOf,
  branchMenuContext,
  branchNodesById,
  buildBranchTree,
  type DeleteTarget,
  defaultExpanded,
  deleteTargetOf,
  localBranchOf,
  restoreExpanded,
  type StartPoint,
  startOf,
  type Tracking,
  toTreeNodes,
  trackingOf,
} from "../logic/log/branchTree.js";
import { branchCopyText } from "../logic/log/copy.js";
import type { BranchFilter } from "../logic/log/filter.js";
import type { MenuViews } from "../logic/menuItems.js";
import type { TreeNode } from "../logic/tree/tree.js";
import Tree from "../tree/Tree.vue";
import { viewState } from "../vscodeApi.js";
import TrackingBadge from "./TrackingBadge.vue";

/**
 * 左栏分支树，建在基础树 `Tree.vue` 上。单击选中；双击按该分支过滤 Log。
 * 展开状态存进 `viewState`，收起再展开、重新加载窗口都恢复。
 */
const props = defineProps<{ refs: readonly Ref[]; repo: string }>();
const emit = defineEmits<{
  /**
   * 选中的本地分支名（更新的对象），选中的不是本地分支时是 `undefined`；
   * 选中节点的起点（新建分支），目录与分组是 `undefined`；
   * 能删的话删什么（`deleteTargetOf`）。
   */
  select: [
    branch: string | undefined,
    start: StartPoint | undefined,
    deletable: DeleteTarget | undefined,
  ];
  /** 双击（或回车）一个分支：按它过滤 Log。HEAD 那行是当前分支；detached、目录、分组没有反应。 */
  filter: [branch: BranchFilter];
  /** 选中一行时按了复制快捷键：要复制的分支名（`branchCopyText`）。 */
  copy: [text: string];
}>();

const tree = computed(() => buildBranchTree(props.refs));
const nodes = computed(() => toTreeNodes(tree.value));
const byId = computed(() => branchNodesById(tree.value));

/** 一行的同步状态（ahead / behind / gone），画在分支名后面。 */
function tracking(node: TreeNode): Tracking | undefined {
  const branch = byId.value.get(node.id);
  return branch === undefined ? undefined : trackingOf(branch);
}

/**
 * 选中的节点 id。分支数据每次变化都按它重新报一次选中的是什么：节点没了（比如删掉了选中的分支）
 * 就报「没选」，Update / Delete 随之置灰；HEAD 那行在 Checkout 后报新的当前分支。
 */
const selectedId = ref<string>();
watch([selectedId, byId], ([id, index]) => {
  const node = id === undefined ? undefined : index.get(id);
  emit(
    "select",
    node === undefined ? undefined : localBranchOf(node),
    node === undefined ? undefined : startOf(node),
    node === undefined ? undefined : deleteTargetOf(node),
  );
});

/** 复制快捷键（Ctrl+C / Cmd+C）：复制选中那行的分支名。目录与分组没有。 */
function onKeydown(event: KeyboardEvent): void {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "c") return;
  const node = selectedId.value === undefined ? undefined : byId.value.get(selectedId.value);
  const text = node === undefined ? undefined : branchCopyText(node);
  if (text === undefined) return;
  event.preventDefault();
  emit("copy", text);
}

function onActivate(node: TreeNode): void {
  const branch = byId.value.get(node.id);
  const filter = branch === undefined ? undefined : branchFilterOf(branch);
  if (filter !== undefined) emit("filter", filter);
}

/**
 * 当前展开的节点。第一次有分支数据时定下来：存过就用存的，没存过按默认值（`defaultExpanded`）。
 * 之前没有分支数据，算不出默认值（当前分支所在的目录要展开）。
 */
const expanded = ref<ReadonlySet<string>>(new Set());
let settled = false;
watch(
  tree,
  (current) => {
    if (settled || props.refs.length === 0) return;
    settled = true;
    expanded.value = restoreExpanded(viewState.read("branches")) ?? defaultExpanded(current);
  },
  { immediate: true },
);

/** 选中变了：竖按钮跟着恰好选中的那一个走，多选时都置灰。 */
function onSelect(selected: readonly TreeNode[]): void {
  const [only] = selected;
  selectedId.value = selected.length === 1 ? only?.id : undefined;
}

/** 右键菜单：树节点换回分支树的节点，交给 `branchMenuContext`。 */
function menuOf(views: MenuViews<TreeNode>) {
  const toBranch = (list: readonly TreeNode[]): BranchNode[] =>
    list.flatMap((node) => {
      const branch = byId.value.get(node.id);
      return branch === undefined ? [] : [branch];
    });
  return branchMenuContext(
    { exact: toBranch(views.exact), expanded: toBranch(views.expanded) },
    props.repo,
  );
}

function onExpanded(next: ReadonlySet<string>): void {
  expanded.value = next;
  viewState.write("branches", [...next]);
}
</script>

<template>
  <Tree
    :nodes="nodes"
    :expanded="expanded"
    :menu="menuOf"
    @update:expanded="onExpanded"
    @select="onSelect"
    @activate="onActivate"
    @keydown="onKeydown"
  >
    <template #after="{ node }">
      <TrackingBadge :state="tracking(node)" />
    </template>
  </Tree>
</template>

