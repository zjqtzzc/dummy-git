<script setup lang="ts">
import type { Ref } from "@dummy-git/shared";
import { computed, ref, watch } from "vue";
import {
  type BranchNode,
  branchFilterOf,
  branchMenuContext,
  branchNodesById,
  branchViews,
  buildBranchTree,
  defaultExpanded,
  restoreExpanded,
  type Tracking,
  toTreeNodes,
  trackingOf,
} from "../logic/log/branchTree.js";
import { branchCopyText } from "../logic/log/copy.js";
import type { BranchFilter } from "../logic/log/filter.js";
import type { MenuViews } from "../logic/menuItems.js";
import { branchIds, type TreeNode } from "../logic/tree/tree.js";
import Tree from "../tree/Tree.vue";
import { viewState } from "../vscodeApi.js";
import TrackingBadge from "./TrackingBadge.vue";

/**
 * 左栏分支树，建在基础树 `Tree.vue` 上。单击选中；双击按该分支过滤 Log。
 * 展开状态存进 `viewState`，收起再展开、重新加载窗口都恢复。
 */
const props = defineProps<{ refs: readonly Ref[]; repo: string }>();
const emit = defineEmits<{
  /** 选中（两种看法，`branchViews`）：竖按钮拿它算能不能点、作用于谁，和右键菜单同一份定义。 */
  select: [views: MenuViews<BranchNode>];
  /** 双击（或回车）一个分支：按它过滤 Log。HEAD 那行是当前分支；detached、目录、分组没有反应。 */
  filter: [branch: BranchFilter];
  /** 按了复制快捷键：选中的行一行一个，分支是全名（`branchCopyText`），目录、分组是显示的文字。 */
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
 * 点中的节点 id（看得见的选中行）。分支数据每次变化都按它重新报一次选中：节点没了（比如删掉了选中的分支）
 * 就不算，按钮随之置灰；HEAD 那行在 Checkout 后代表新的当前分支。
 */
const selectedIds = ref<readonly string[]>([]);
watch([selectedIds, byId], ([ids, index]) => emit("select", branchViews(ids, index)));

/** 复制时分支复制全名（显示的只是最后一段），HEAD 那行复制当前分支名；目录、分组复制显示的文字。 */
function copyTextOf(node: TreeNode): string | undefined {
  const branch = byId.value.get(node.id);
  return branch === undefined ? undefined : branchCopyText(branch);
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

function onSelect(views: MenuViews<TreeNode>): void {
  selectedIds.value = views.exact.map((node) => node.id);
}

/** 右键菜单：点中的节点换回分支树的节点，交给 `branchMenuContext`。 */
function menuOf(views: MenuViews<TreeNode>) {
  return branchMenuContext(
    branchViews(
      views.exact.map((node) => node.id),
      byId.value,
    ),
    props.repo,
  );
}

function onExpanded(next: ReadonlySet<string>): void {
  expanded.value = next;
  viewState.write("branches", [...next]);
}

defineExpose({
  /** 全部展开 / 全部收起（竖按钮区）。和手动展开收起一样存进 `viewState`。 */
  expandAll(): void {
    onExpanded(new Set(branchIds(nodes.value)));
  },
  collapseAll(): void {
    onExpanded(new Set());
  },
});
</script>

<template>
  <Tree
    :nodes="nodes"
    :expanded="expanded"
    :menu="menuOf"
    @update:expanded="onExpanded"
    @select="onSelect"
    :copy-text-of="copyTextOf"
    @activate="onActivate"
    @copy="(text) => emit('copy', text)"
  >
    <template #after="{ node }">
      <TrackingBadge :state="tracking(node)" />
    </template>
  </Tree>
</template>

