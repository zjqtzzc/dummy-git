<script setup lang="ts">
import { assertNever } from "@dummy-git/shared";
import { type BranchNode, BranchNodeKind } from "../logic/log/branchTree.js";

/** 分支树的一个节点，递归画出子节点。 */
defineProps<{ node: BranchNode; expanded: ReadonlySet<string> }>();

/** 节点 → codicon 名。表放在用它的模块里（CLAUDE.md B.3）。 */
function icon(node: BranchNode): string {
  switch (node.kind) {
    case BranchNodeKind.Head:
      return "target";
    case BranchNodeKind.Group:
      return node.id === "local" ? "device-desktop" : "cloud";
    case BranchNodeKind.Folder:
      return "folder";
    case BranchNodeKind.Branch:
      return node.current ? "tag" : "git-branch";
    default:
      return assertNever(node, "icon");
  }
}
</script>

<template>
  <vscode-tree-item
    v-if="node.kind === BranchNodeKind.Group || node.kind === BranchNodeKind.Folder"
    branch
    :open="expanded.has(node.id)"
    :data-id="node.id"
  >
    <vscode-icon slot="icon-branch" :name="icon(node)" />
    <vscode-icon
      slot="icon-branch-opened"
      :name="node.kind === BranchNodeKind.Folder ? 'folder-opened' : icon(node)"
    />
    {{ node.label }}
    <BranchTreeNode
      v-for="child in node.children"
      :key="child.id"
      :node="child"
      :expanded="expanded"
    />
  </vscode-tree-item>
  <vscode-tree-item v-else :data-id="node.id">
    <vscode-icon
      slot="icon-leaf"
      :name="icon(node)"
      :class="{ current: node.kind === BranchNodeKind.Branch && node.current }"
    />
    <span :class="{ current: node.kind === BranchNodeKind.Branch && node.current }">{{
      node.label
    }}</span>
  </vscode-tree-item>
</template>

<style scoped>
.current {
  font-weight: 600;
}
/* 当前分支的标签图标用主题的图表黄，比对勾醒目；跟着主题走，不写死颜色。 */
vscode-icon.current {
  color: var(--vscode-charts-yellow);
}
</style>
