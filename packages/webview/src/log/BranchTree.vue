<script setup lang="ts">
import type { Ref } from "@dummy-git/shared";
import { computed, ref, watch } from "vue";
import {
  branchNodesById,
  buildBranchTree,
  defaultExpanded,
  localBranchOf,
  restoreExpanded,
  type StartPoint,
  startOf,
  type Tracking,
  toTreeNodes,
  trackingOf,
} from "../logic/log/branchTree.js";
import type { TreeNode } from "../logic/tree/tree.js";
import Tree from "../tree/Tree.vue";
import { viewState } from "../vscodeApi.js";
import TrackingBadge from "./TrackingBadge.vue";

/**
 * 左栏分支树，建在基础树 `Tree.vue` 上。单击只选中；双击本阶段无反应（第 5 阶段改为按该分支筛选）。
 * 展开状态存进 `viewState`，收起再展开、重新加载窗口都恢复。
 */
const props = defineProps<{ refs: readonly Ref[]; repo: string }>();
const emit = defineEmits<{
  /**
   * 选中的本地分支名（拉取、推送的对象），选中的不是本地分支时是 `undefined`；
   * 选中节点的起点（新建分支），目录与分组是 `undefined`。
   */
  select: [branch: string | undefined, start: StartPoint | undefined];
}>();

const tree = computed(() => buildBranchTree(props.refs));
const nodes = computed(() => toTreeNodes(tree.value, props.repo));
const byId = computed(() => branchNodesById(tree.value));

/** 一行的同步状态（ahead / behind / gone），画在分支名后面。 */
function tracking(node: TreeNode): Tracking | undefined {
  const branch = byId.value.get(node.id);
  return branch === undefined ? undefined : trackingOf(branch);
}

function onSelect(node: TreeNode): void {
  const branch = byId.value.get(node.id);
  emit(
    "select",
    branch === undefined ? undefined : localBranchOf(branch),
    branch === undefined ? undefined : startOf(branch),
  );
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

function onExpanded(next: ReadonlySet<string>): void {
  expanded.value = next;
  viewState.write("branches", [...next]);
}
</script>

<template>
  <Tree :nodes="nodes" :expanded="expanded" @update:expanded="onExpanded" @select="onSelect">
    <template #after="{ node }">
      <TrackingBadge :state="tracking(node)" />
    </template>
  </Tree>
</template>

