<script setup lang="ts">
import {
  type Commit,
  type CommitFileChange,
  DiffOpenMode,
  FileStatus,
  GitDomain,
  type Ref,
  RefKind,
} from "@dummy-git/shared";
import { nextTick, onMounted, onUnmounted, ref } from "vue";
import BranchTree from "./BranchTree.vue";
import CommitList from "./CommitList.vue";
import type { Client } from "./logic/client.js";
import { commitDiffSides } from "./logic/commitDiff.js";
import { type Layout, restoreLayout, splitPercent } from "./logic/layout.js";
import { hashesToFetch } from "./logic/prefetch.js";
import type { RowRange } from "./logic/virtualList.js";
import { viewState } from "./vscodeApi.js";

/** Log 面板：左分支（第 10 步）、中提交列表、右文件（第 11 步重做）。 */
const props = defineProps<{ client: Client }>();

/**
 * git 的状态 → 给人看的字。
 *
 * 这张表放在**用它的模块里**（`CLAUDE.md` B.3）：它是 UI 的投影，
 * 别的地方（比如图标、排序）会有各自不同的表，不该共用一个。
 */
const STATUS_LABEL: Readonly<Record<FileStatus, string>> = {
  [FileStatus.Unchanged]: " ",
  [FileStatus.Modified]: "M",
  [FileStatus.Added]: "A",
  [FileStatus.Deleted]: "D",
  [FileStatus.Renamed]: "R",
  [FileStatus.Copied]: "C",
  [FileStatus.TypeChanged]: "T",
};

/** `ref`：`.value` 一改，用到它的模板就重画。 */
const repo = ref<string>();
/** 骨架的顺序，最多一万条（`ARCHITECTURE.md` 第 8 题）。 */
const hashes = ref<string[]>([]);
/** 已经取到的详情。同一个 hash 的内容永远不变，刷新时不清。 */
const details = ref(new Map<string, Commit>());
/** 正在路上的详情请求，避免重复要。不参与界面，不用 ref。 */
const inFlight = new Set<string>();
const loaded = ref(false);
/** 分支、tag 与 HEAD，左栏用。 */
const refs = ref<Ref[]>([]);
const selected = ref<string>();
const files = ref<CommitFileChange[]>([]);
const error = ref<string>();
const list = ref<InstanceType<typeof CommitList>>();

/** 「现在」，秒。每 30 秒走一次，「5 minutes ago」才会跟着变。 */
const now = ref(Math.floor(Date.now() / 1000));
const clock = setInterval(() => {
  now.value = Math.floor(Date.now() / 1000);
}, 30_000);
onUnmounted(() => clearInterval(clock));

function report(cause: unknown): void {
  error.value = cause instanceof Error ? cause.message : String(cause);
}

/** 可见范围变了：把范围前后还没有详情的提交取回来。 */
async function fetchVisible(range: RowRange): Promise<void> {
  if (repo.value === undefined) return;
  const known = new Set([...details.value.keys(), ...inFlight]);
  const wanted = hashesToFetch(hashes.value, range, known);
  if (wanted.length === 0) return;
  for (const hash of wanted) inFlight.add(hash);
  try {
    const commits = await props.client.request("getCommitDetails", {
      repo: repo.value,
      hashes: wanted,
    });
    for (const commit of commits) details.value.set(commit.hash, commit);
  } catch (cause) {
    report(cause);
  } finally {
    for (const hash of wanted) inFlight.delete(hash);
  }
}

async function select(hash: string): Promise<void> {
  selected.value = hash;
  files.value = [];
  try {
    if (repo.value === undefined) return;
    files.value = await props.client.request("getCommitFiles", { repo: repo.value, hash });
  } catch (cause) {
    report(cause);
  }
}

/**
 * 拉骨架与 refs。首次打开、以及 refs 变了之后都走这里。
 *
 * 选中的提交还在：让它停在屏幕上原来的位置（上方多了新提交时视图不跳）。
 * 不在了（或首次打开）：改选 HEAD 所在的提交并滚过去——列表第一行不一定是 HEAD。
 */
async function load(repository: string): Promise<void> {
  try {
    const [skeleton, fetchedRefs] = await Promise.all([
      props.client.request("getSkeleton", { repo: repository }),
      props.client.request("getRefs", { repo: repository }),
    ]);
    const previous = selected.value === undefined ? -1 : hashes.value.indexOf(selected.value);
    hashes.value = skeleton.map((commit) => commit.hash);
    refs.value = fetchedRefs;
    loaded.value = true;
    error.value = undefined;
    await nextTick();

    const kept = selected.value === undefined ? -1 : hashes.value.indexOf(selected.value);
    if (previous !== -1 && kept !== -1) {
      list.value?.shift(previous, kept);
      return;
    }
    const head = fetchedRefs.find((r) => r.kind === RefKind.Head)?.target;
    const row = head === undefined ? -1 : hashes.value.indexOf(head);
    if (head === undefined || row === -1) return;
    list.value?.reveal(row);
    await select(head);
  } catch (cause) {
    report(cause);
  }
}

/** 临时：第 11 步按「双击打开、单击跟随」重做。 */
async function openFile(file: CommitFileChange): Promise<void> {
  const commit = selected.value === undefined ? undefined : details.value.get(selected.value);
  if (repo.value === undefined || commit === undefined) return;
  const { left, right } = commitDiffSides(commit.hash, commit.parents, file);
  await props.client.request("openDiff", {
    repo: repo.value,
    left,
    right,
    mode: DiffOpenMode.Open,
  });
}

onMounted(async () => {
  // 先握手，再问有哪些仓库，拿到第一个就开始拉。
  // 扩展侧在收到 ready 之前一个字节都不发，所以不存在「发早了被丢掉」。
  props.client.start();
  try {
    const roots = await props.client.request("getRepositories", {});
    const first = roots[0];
    if (first === undefined) return;
    repo.value = first;
    // **只在 refs 变了才重拉提交列表。** 保存一次工作区文件只会得到 worktree，
    // 不该触发提交列表重算。
    props.client.onDomainsChanged((_changed, domains) => {
      if (domains.includes(GitDomain.Refs)) void load(first);
    });
    await load(first);
  } catch (cause) {
    report(cause);
  }
});

/**
 * 三栏宽度。从 `viewState` 取回（收起再展开、重新加载窗口都在），拖动时存回去。
 *
 * 外层 `fixed-pane="start"`、内层 `fixed-pane="end"`：窗口或面板大小变化时，
 * 左栏和右栏保持像素宽度，只有中间的提交列表伸缩。设了 fixed-pane，组件才会自己
 * 监听尺寸变化；不设的话它不跟踪宽度，改过尺寸后第一次按下分隔线会跳位。
 */
let layout: Layout = restoreLayout(viewState.read("layout"));

function onSplit(which: keyof Layout, event: Event): void {
  const percent = splitPercent(event);
  if (percent === undefined) return;
  layout = { ...layout, [which]: percent };
  viewState.write("layout", layout);
}
</script>

<template>
  <vscode-split-layout
    class="layout"
    split="vertical"
    fixed-pane="start"
    :initial-handle-position="`${layout.outer}%`"
    @vsc-split-layout-change="onSplit('outer', $event)"
  >
    <div slot="start" class="pane">
      <BranchTree :refs="refs" />
    </div>

    <vscode-split-layout
      slot="end"
      split="vertical"
      fixed-pane="end"
      :initial-handle-position="`${layout.inner}%`"
      @vsc-split-layout-change="onSplit('inner', $event)"
    >
      <div slot="start" class="pane">
        <p v-if="error !== undefined" class="error">{{ error }}</p>
        <p v-if="!loaded" class="dim loading">Loading…</p>
        <CommitList
          v-else
          ref="list"
          :hashes="hashes"
          :details="details"
          :selected="selected"
          :now="now"
          @select="select"
          @visible="fetchVisible"
        />
      </div>

      <div slot="end" class="panel">
        <h2>Files</h2>
        <ul class="list">
          <li
            v-for="file in files"
            :key="`${file.status}:${file.oldPath ?? ''}:${file.path}`"
            class="row"
            @dblclick="openFile(file)"
          >
            <code>{{ STATUS_LABEL[file.status] }}</code>
            <span class="subject">{{
              file.oldPath === undefined ? file.path : `${file.oldPath} → ${file.path}`
            }}</span>
          </li>
        </ul>
      </div>
    </vscode-split-layout>
  </vscode-split-layout>
</template>
