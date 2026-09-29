<script setup lang="ts">
import { type CommitFileChange, DiffOpenMode } from "@dummy-git/shared";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import FileTreeNode from "./FileTreeNode.vue";
import { buildFileTree } from "./logic/fileTree.js";

/**
 * 右栏文件树（`.notes/design/phase-1.md` 第 1、5 条）：全部展开；双击或回车打开 diff，
 * 单击或上下键时 diff 跟随（真正开不开由 `openDiff` 判断，见扩展侧 `diffTab.ts`）。
 */
const props = defineProps<{ files: readonly CommitFileChange[] }>();
const emit = defineEmits<{ open: [change: CommitFileChange, mode: DiffOpenMode] }>();

const tree = computed(() => buildFileTree(props.files));

/** 浅色主题用 Seti 的 `_light` 那一套。VS Code 切主题时改 body 的类名，跟着它走。 */
const light = ref(false);
function readTheme(): void {
  const classes = document.body.classList;
  light.value = classes.contains("vscode-light") || classes.contains("vscode-high-contrast-light");
}
const themeWatch = new MutationObserver(readTheme);
onMounted(() => {
  readTheme();
  themeWatch.observe(document.body, { attributes: true, attributeFilter: ["class"] });
});
onUnmounted(() => themeWatch.disconnect());

/** 节点 id（完整路径）→ 文件改动。树里只有 id，打开时查回来。 */
const byId = computed(() => new Map(props.files.map((change) => [change.path, change])));

function fileAt(event: Event): CommitFileChange | undefined {
  if (!(event.target instanceof Element)) return undefined;
  const id = event.target.closest("vscode-tree-item")?.getAttribute("data-id");
  return id === null || id === undefined ? undefined : byId.value.get(id);
}

/** 上次跟随的文件：焦点在同一个文件上重复进入时不再跟，免得 diff 标签关了又开。 */
let followed: string | undefined;
// 换了一条提交，文件列表整个换了：同名文件也要重新跟。
watch(
  () => props.files,
  () => {
    followed = undefined;
  },
);

/** 单击和上下键都会把焦点移到某一行上。 */
function onFocusin(event: FocusEvent): void {
  const change = fileAt(event);
  if (change === undefined || change.path === followed) return;
  followed = change.path;
  emit("open", change, DiffOpenMode.Follow);
}

function onOpen(event: Event): void {
  const change = fileAt(event);
  if (change === undefined) return;
  followed = change.path;
  emit("open", change, DiffOpenMode.Open);
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Enter") onOpen(event);
}
</script>

<template>
  <vscode-tree
    class="file-tree"
    indent-guides="onHover"
    @focusin="onFocusin"
    @dblclick="onOpen"
    @keydown="onKeydown"
  >
    <FileTreeNode v-for="node in tree" :key="node.id" :node="node" :light="light" />
  </vscode-tree>
</template>

<style scoped>
.file-tree {
  height: 100%;
  overflow: auto;
}
</style>
