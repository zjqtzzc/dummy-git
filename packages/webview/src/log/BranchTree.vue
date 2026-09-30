<script setup lang="ts">
import type { Ref } from "@dummy-git/shared";
import { computed, onMounted, onUnmounted, ref } from "vue";
import { buildBranchTree, defaultExpanded, restoreExpanded } from "../logic/log/branchTree.js";
import { viewState } from "../vscodeApi.js";
import BranchTreeNode from "./BranchTreeNode.vue";
import { collapseDescendants } from "./treeCollapse.js";

/**
 * 左栏分支树。单击只选中；双击本阶段无反应（第 5 阶段改为按该分支筛选）。
 * 展开状态存进 `viewState`，收起再展开、重新加载窗口都恢复。
 */
const props = defineProps<{ refs: readonly Ref[] }>();

const tree = computed(() => buildBranchTree(props.refs));

/**
 * 当前展开的节点。不做成响应式：展开 / 折叠由树组件自己改 `open`，这里只跟着记；
 * 若做成响应式，重新渲染会和组件自己的状态打架。
 * 第一次有分支数据时，没存过就按默认值（`defaultExpanded`）。
 */
let expanded: Set<string> | undefined;
function expandedNow(): ReadonlySet<string> {
  if (expanded === undefined && props.refs.length > 0) {
    expanded = new Set(restoreExpanded(viewState.read("branches")) ?? defaultExpanded(tree.value));
  }
  return expanded ?? new Set();
}

/**
 * 树组件展开 / 折叠时不发事件，但会把 `open` 同步到 HTML 属性上。
 * 监听这个属性，记下当前展开的所有 id。
 */
const root = ref<HTMLElement>();
const observer = new MutationObserver((mutations) => {
  if (expanded === undefined) return;
  for (const mutation of mutations) {
    if (!(mutation.target instanceof HTMLElement)) continue;
    const id = mutation.target.dataset["id"];
    if (id === undefined) continue;
    if (mutation.target.hasAttribute("open")) expanded.add(id);
    else expanded.delete(id);
  }
  viewState.write("branches", [...expanded]);
});
let collapsing: MutationObserver | undefined;
onMounted(() => {
  if (root.value !== undefined) {
    observer.observe(root.value, { subtree: true, attributes: true, attributeFilter: ["open"] });
    collapsing = collapseDescendants(root.value);
  }
});
onUnmounted(() => {
  observer.disconnect();
  collapsing?.disconnect();
});
</script>

<template>
  <div ref="root" class="branch-tree">
    <vscode-tree indent-guides="onHover">
      <BranchTreeNode
        v-for="node in tree"
        :key="node.id"
        :node="node"
        :expanded="expandedNow()"
      />
    </vscode-tree>
  </div>
</template>

<style scoped>
.branch-tree {
  height: 100%;
  overflow: auto;
}
</style>
