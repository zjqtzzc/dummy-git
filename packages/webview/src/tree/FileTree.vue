<script setup lang="ts">
import { DiffOpenMode } from "@dummy-git/shared";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { buildFileTree, type FileEntry, type FileGroup, toTreeNodes } from "../logic/tree/fileTree.js";
import { branchIds, type TreeNode } from "../logic/tree/tree.js";
import Tree from "./Tree.vue";

/**
 * 所有文件树共用的一层（`.notes/design/phase-2.md` 第一节第 5 条），建在基础树 `Tree.vue` 上：
 * 分组的文件整理成树、配上 Seti 图标与改动字母；新出现的目录默认展开；
 * 双击或回车打开 diff，单击或上下键时 diff 跟随（真正开不开由扩展侧 `vscode/diff.ts` 判断）。
 * 只认 `FileEntry`，左右各是什么由使用方决定。
 * 给了 `checked`（勾选的路径）才有复选框；勾选状态由使用方持有，这里只转发 `check`。
 */
const props = defineProps<{
  groups: readonly FileGroup[];
  checked?: ReadonlySet<string> | undefined;
}>();
const emit = defineEmits<{
  open: [entry: FileEntry, mode: DiffOpenMode];
  /** 叶子的 id 就是文件路径。 */
  check: [paths: readonly string[], value: boolean];
}>();

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

const nodes = computed(() => toTreeNodes(buildFileTree(props.groups), light.value));

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

/** 节点 id（完整路径）→ 文件。目录的路径不会和文件相同，组的 id 带前缀，查不到的就不是文件。 */
const byId = computed(
  () => new Map(props.groups.flatMap((group) => group.entries.map((entry) => [entry.path, entry]))),
);

/** 上次跟随的文件：同一个文件重复选中时不再跟，免得 diff 反复打开。 */
let followed: string | undefined;
// 文件列表整个换了（比如换了一条提交）：同名文件也要重新跟。
watch(
  () => props.groups,
  () => {
    followed = undefined;
  },
);

function onSelect(node: TreeNode): void {
  const entry = byId.value.get(node.id);
  if (entry === undefined || entry.path === followed) return;
  followed = entry.path;
  emit("open", entry, DiffOpenMode.Follow);
}

function onActivate(node: TreeNode): void {
  const entry = byId.value.get(node.id);
  if (entry === undefined) return;
  followed = entry.path;
  emit("open", entry, DiffOpenMode.Open);
}
</script>

<template>
  <Tree
    v-model:expanded="expanded"
    :nodes="nodes"
    :checked="checked"
    @select="onSelect"
    @activate="onActivate"
    @check="(paths, value) => emit('check', paths, value)"
  />
</template>
