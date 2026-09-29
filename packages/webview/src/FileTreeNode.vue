<script setup lang="ts">
import { FileStatus } from "@dummy-git/shared";
import { computed } from "vue";
import { type FileNode, FileNodeKind } from "./logic/fileTree.js";
import { setiIcon } from "./logic/setiIcon.js";

/** 文件树的一个节点，递归画出子节点。 */
const props = defineProps<{ node: FileNode; light: boolean }>();

/** 改动类型 → 右侧字母与 git 装饰色（与资源管理器、源代码管理的配色一致）。 */
const STATUS: Readonly<Record<FileStatus, { readonly letter: string; readonly color: string }>> = {
  [FileStatus.Unchanged]: { letter: "", color: "inherit" },
  [FileStatus.Modified]: {
    letter: "M",
    color: "var(--vscode-gitDecoration-modifiedResourceForeground)",
  },
  [FileStatus.Added]: { letter: "A", color: "var(--vscode-gitDecoration-addedResourceForeground)" },
  [FileStatus.Deleted]: {
    letter: "D",
    color: "var(--vscode-gitDecoration-deletedResourceForeground)",
  },
  [FileStatus.Renamed]: {
    letter: "R",
    color: "var(--vscode-gitDecoration-renamedResourceForeground)",
  },
  [FileStatus.Copied]: { letter: "C", color: "var(--vscode-gitDecoration-addedResourceForeground)" },
  [FileStatus.TypeChanged]: {
    letter: "T",
    color: "var(--vscode-gitDecoration-modifiedResourceForeground)",
  },
};

const icon = computed(() => setiIcon(props.node.label, props.light));
</script>

<template>
  <vscode-tree-item
    v-if="node.kind === FileNodeKind.Folder"
    branch
    open
    :data-id="node.id"
  >
    <vscode-icon slot="icon-branch" name="folder" />
    <vscode-icon slot="icon-branch-opened" name="folder-opened" />
    {{ node.label }}
    <span slot="description">{{ node.count === 1 ? "1 file" : `${node.count} files` }}</span>
    <FileTreeNode v-for="child in node.children" :key="child.id" :node="child" :light="light" />
  </vscode-tree-item>
  <vscode-tree-item v-else :data-id="node.id">
    <span slot="icon-leaf" class="seti" :style="{ color: icon.color }">{{ icon.char }}</span>
    <span :style="{ color: STATUS[node.change.status].color }">{{ node.label }}</span>
    <span v-if="node.renamedFrom !== undefined" slot="description"
      >renamed from {{ node.renamedFrom }}</span
    >
    <span slot="decoration" :style="{ color: STATUS[node.change.status].color }">{{
      STATUS[node.change.status].letter
    }}</span>
  </vscode-tree-item>
</template>

<style scoped>
/*
 * Seti 图标（参照 GitLens 的 gl-file-icon）：
 * - 16×16 的方框里用 flex 上下左右居中，行高 1。不用 22px 行高去撑——那样字形的上下位置
 *   取决于 Seti 字体自己不对称的上下边距，看起来偏上；
 * - 字号 150%：Seti 主题文件的规定，字形四周留了空白，放大后才和资源管理器里一样大；
 * - 灰度抗锯齿：macOS 默认的次像素抗锯齿会让图标字体发粗，VS Code 同样关掉了它。
 */
.seti {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  font-family: "seti", sans-serif;
  font-size: 150%;
  line-height: 1;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
</style>
