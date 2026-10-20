<script setup lang="ts">
import { DiffOpenMode, GitDomain } from "@dummy-git/shared";
import { computed, onMounted, ref, watch } from "vue";
import { type Client, report } from "../logic/client.js";
import { AppIcon, appIcon, codicon } from "../logic/icons.js";
import { commitDiffSides } from "../logic/log/commitDiff.js";
import type { MenuViews } from "../logic/menuItems.js";
import {
  type StashFiles,
  stashByNodeId,
  stashFilesById,
  stashMenuContext,
  stashTreeNodes,
} from "../logic/stash/stashTree.js";
import { branchIds, type TreeNode } from "../logic/tree/tree.js";
import Tree from "../tree/Tree.vue";
import { useLightTheme } from "../ui/lightTheme.js";
import ToolButton from "../ui/ToolButton.vue";

/**
 * Commit 面板的 Stash 模式：全部 stash，最新的在最上，
 * 每条下面是它改了的文件。单击文件 diff 跟随、双击打开，左边存时所在的提交，右边 stash 里的版本。
 *
 * 工具栏 Apply、Delete 作用于选中的那条；右键 stash 那一行还有 Pop（菜单项由扩展注册）。
 * 一直挂着（切模式只是隐藏），所以只订阅一次 stash 域的变化。
 */
const props = defineProps<{ client: Client; repo: string | undefined }>();

const list = ref<StashFiles[]>([]);
const loaded = ref(false);
const light = useLightTheme();
/** 时间按载入那一刻写；stash 列表一变就重新载入。 */
const now = ref(Date.now() / 1000);

const nodes = computed(() => stashTreeNodes(list.value, light.value, now.value));
const filesById = computed(() => stashFilesById(list.value));
const owners = computed(() => stashByNodeId(nodes.value));

/**
 * 选中的行与它所属的 stash（Apply / Delete 的对象）。选中 stash 那一行或它下面的文件都算。
 * 列表一变就按 id 重新找：那条 stash 没了（被删、被 Pop），选中落空，两个按钮置灰。
 */
const selectedId = ref<string>();
const selectedStash = computed(() =>
  selectedId.value === undefined ? undefined : owners.value.get(selectedId.value),
);
/** 正在 Apply / Delete：两个按钮置灰，防重复点击。 */
const busy = ref(false);

/**
 * 展开状态。每条 stash 默认收起；它下面的目录默认展开，展开 stash 就直接看到文件。
 * 第一次见到的 id 才按默认值，之后用户的展开 / 收起保持。
 */
const expanded = ref<ReadonlySet<string>>(new Set());
let known = new Set<string>();
watch(nodes, (current) => {
  const stashes = new Set(current.map((node) => node.id));
  const ids = branchIds(current);
  const next = new Set(expanded.value);
  for (const id of ids) if (!known.has(id) && !stashes.has(id)) next.add(id);
  known = new Set(ids);
  expanded.value = next;
});

/** 最近一次载入的序号：先发的可能后回来，只收最新那次。 */
let latest = 0;
async function load(repo: string): Promise<void> {
  const mine = ++latest;
  try {
    const stashes = await props.client.request("getStashes", { repo });
    const filesOf = (hash: string | undefined) =>
      hash === undefined ? Promise.resolve([]) : props.client.request("getCommitFiles", { repo, hash });
    const next = await Promise.all(
      stashes.map(async (stash) => {
        const [tracked, untracked] = await Promise.all([filesOf(stash.hash), filesOf(stash.untracked)]);
        return { stash, tracked, untracked };
      }),
    );
    if (mine !== latest) return;
    now.value = Date.now() / 1000;
    list.value = next;
    loaded.value = true;
  } catch (cause) {
    report(cause);
  }
}

watch(
  () => props.repo,
  (repo) => {
    if (repo !== undefined) void load(repo);
  },
  { immediate: true },
);
onMounted(() => {
  props.client.onDomainsChanged((_changed, domains) => {
    if (props.repo !== undefined && domains.includes(GitDomain.Stash)) void load(props.repo);
  });
});

/** Apply 与 Delete（确认框由扩展弹）。完成消息与错误都由扩展侧显示。 */
async function act(command: "applyStash" | "dropStash"): Promise<void> {
  const hash = selectedStash.value;
  if (props.repo === undefined || hash === undefined || busy.value) return;
  busy.value = true;
  try {
    await props.client.request(command, { repo: props.repo, hash });
  } catch (cause) {
    report(cause);
  } finally {
    busy.value = false;
  }
}

/** 选中变了：按钮跟着恰好选中的那一个走，多选时置灰；diff 只在恰好选中一个文件时跟。 */
function onSelect(selected: readonly TreeNode[]): void {
  const [node] = selected;
  selectedId.value = selected.length === 1 ? node?.id : undefined;
  if (selected.length === 1 && node !== undefined) void open(node, DiffOpenMode.Follow);
}

/** 右键菜单：stash 那一行换成它的 hash，它下面的文件、目录是 `null`。 */
function menuOf(views: MenuViews<TreeNode>) {
  const stashes = new Set(list.value.map(({ stash }) => stash.hash));
  const toHash = (node: TreeNode): string | null => (stashes.has(node.id) ? node.id : null);
  return stashMenuContext(
    { exact: views.exact.map(toHash), expanded: views.expanded.map(toHash) },
    props.repo ?? "",
  );
}

/** 上次跟随的文件：同一个文件重复选中时不再跟，免得 diff 反复打开。 */
let followed: string | undefined;

async function open(node: TreeNode, mode: DiffOpenMode): Promise<void> {
  const target = filesById.value.get(node.id);
  if (props.repo === undefined || target === undefined) return;
  if (mode === DiffOpenMode.Follow && node.id === followed) return;
  followed = node.id;
  const { left, right } = commitDiffSides(target.hash, target.parents, target.file);
  try {
    await props.client.request("openDiff", { repo: props.repo, left, right, mode });
  } catch (cause) {
    report(cause);
  }
}
</script>

<template>
  <div class="stash-view">
    <div class="toolbar">
      <ToolButton
        :icon="appIcon(AppIcon.Unstash)"
        title="Apply"
        :disabled="selectedStash === undefined || busy"
        @click="act('applyStash')"
      />
      <ToolButton
        :icon="codicon('trash')"
        title="Delete"
        :disabled="selectedStash === undefined || busy"
        @click="act('dropStash')"
      />
    </div>
    <div class="files">
      <p v-if="!loaded" class="dim note">Loading…</p>
      <p v-else-if="list.length === 0" class="dim note">No stashes</p>
      <Tree
        v-else
        v-model:expanded="expanded"
        :nodes="nodes"
        :menu="menuOf"
        @select="onSelect"
        @activate="(node) => open(node, DiffOpenMode.Open)"
      />
    </div>
  </div>
</template>

<style scoped>
.stash-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px 8px;
  border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, transparent);
}
.files {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.note {
  margin: 0;
  padding-top: 24px;
  text-align: center;
}
</style>
