<script setup lang="ts">
import type { Ref } from "@dummy-git/shared";
import { computed, ref, watch } from "vue";
import {
  buildBranchTree,
  defaultExpanded,
  restoreExpanded,
  toTreeNodes,
} from "../logic/log/branchTree.js";
import Tree from "../tree/Tree.vue";
import { viewState } from "../vscodeApi.js";

/**
 * 左栏分支树，建在基础树 `Tree.vue` 上。单击只选中；双击本阶段无反应（第 5 阶段改为按该分支筛选）。
 * 展开状态存进 `viewState`，收起再展开、重新加载窗口都恢复。
 */
const props = defineProps<{ refs: readonly Ref[] }>();

const tree = computed(() => buildBranchTree(props.refs));
const nodes = computed(() => toTreeNodes(tree.value));

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
  <Tree :nodes="nodes" :expanded="expanded" @update:expanded="onExpanded" />
</template>
