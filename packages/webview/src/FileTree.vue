<script setup lang="ts">
import { DiffOpenMode } from "@dummy-git/shared";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import FileTreeNode from "./FileTreeNode.vue";
import { buildFileTree, type FileEntry, type FileGroup } from "./logic/fileTree.js";
import { collapseDescendants } from "./treeCollapse.js";

/**
 * 所有文件树共用的组件（`.notes/design/phase-2.md` 第一节）：全部展开；双击或回车打开 diff，
 * 单击或上下键时 diff 跟随（真正开不开由扩展侧 `vscode/diff.ts` 判断）。
 * 只认 `FileEntry`，左右各是什么由使用方决定。
 */
const props = defineProps<{ groups: readonly FileGroup[] }>();
const emit = defineEmits<{ open: [entry: FileEntry, mode: DiffOpenMode] }>();

const tree = computed(() => buildFileTree(props.groups));

/** 浅色主题用 Seti 的 `_light` 那一套。VS Code 切主题时改 body 的类名，跟着它走。 */
const light = ref(false);
function readTheme(): void {
  const classes = document.body.classList;
  light.value = classes.contains("vscode-light") || classes.contains("vscode-high-contrast-light");
}
const themeWatch = new MutationObserver(readTheme);
const root = ref<HTMLElement>();
let collapsing: MutationObserver | undefined;
onMounted(() => {
  readTheme();
  themeWatch.observe(document.body, { attributes: true, attributeFilter: ["class"] });
  if (root.value !== undefined) collapsing = collapseDescendants(root.value);
});
onUnmounted(() => {
  themeWatch.disconnect();
  collapsing?.disconnect();
});

/** 节点 id（完整路径）→ 文件。树里只有 id，打开时查回来。 */
const byId = computed(
  () => new Map(props.groups.flatMap((group) => group.entries.map((entry) => [entry.path, entry]))),
);

function fileAt(event: Event): FileEntry | undefined {
  if (!(event.target instanceof Element)) return undefined;
  const id = event.target.closest("vscode-tree-item")?.getAttribute("data-id");
  return id === null || id === undefined ? undefined : byId.value.get(id);
}

/** 上次跟随的文件：焦点在同一个文件上重复进入时不再跟，免得 diff 标签关了又开。 */
let followed: string | undefined;
// 文件列表整个换了（比如换了一条提交）：同名文件也要重新跟。
watch(
  () => props.groups,
  () => {
    followed = undefined;
  },
);

/** 单击和上下键都会把焦点移到某一行上。 */
function onFocusin(event: FocusEvent): void {
  const entry = fileAt(event);
  if (entry === undefined || entry.path === followed) return;
  followed = entry.path;
  emit("open", entry, DiffOpenMode.Follow);
}

function onOpen(event: Event): void {
  const entry = fileAt(event);
  if (entry === undefined) return;
  followed = entry.path;
  emit("open", entry, DiffOpenMode.Open);
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Enter") onOpen(event);
}
</script>

<template>
  <vscode-tree
    ref="root"
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
