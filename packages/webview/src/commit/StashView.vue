<script setup lang="ts">
import { DiffOpenMode, GitDomain } from "@dummy-git/shared";
import { computed, onMounted, ref, watch } from "vue";
import { type Client, report } from "../logic/client.js";
import { commitDiffSides } from "../logic/log/commitDiff.js";
import { type StashFiles, stashFilesById, stashTreeNodes } from "../logic/stash/stashTree.js";
import { branchIds, type TreeNode } from "../logic/tree/tree.js";
import Tree from "../tree/Tree.vue";
import { useLightTheme } from "../ui/lightTheme.js";

/**
 * Commit 面板的 Stash 模式（`.notes/design/phase-4.md` 第 8 条）：全部 stash，最新的在最上，
 * 每条下面是它改了的文件。单击文件 diff 跟随、双击打开，左边存时所在的提交，右边 stash 里的版本。
 *
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
    <!-- Apply / Delete 按钮的位置（第 10 条）。先占住这一行，切模式时下面的树不跳。 -->
    <div class="toolbar" />
    <div class="files">
      <p v-if="!loaded" class="dim note">Loading…</p>
      <p v-else-if="list.length === 0" class="dim note">No stashes</p>
      <Tree
        v-else
        v-model:expanded="expanded"
        :nodes="nodes"
        @select="(node) => open(node, DiffOpenMode.Follow)"
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
  height: 22px;
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
