<script setup lang="ts">
import {
  type Commit,
  type CommitFileChange,
  DiffOpenMode,
  FileStatus,
  GitDomain,
} from "@dummy-git/shared";
import { onMounted, ref } from "vue";
import type { Client } from "./logic/client.js";
import { commitDiffSides } from "./logic/commitDiff.js";
import { type Layout, restoreLayout, splitPercent } from "./logic/layout.js";
import { viewState } from "./vscodeApi.js";

/** 地基期的最小界面。第 8 步起按 `.notes/design/phase-1.md` 重做成三栏。 */
const props = defineProps<{ client: Client }>();

/** 一屏显示多少条。骨架跑遍全历史，详情只取要显示的这些（取数模型 B）。 */
const PAGE = 100;

/**
 * git 的状态 → 给人看的字。
 *
 * 这张表放在**用它的模块里**（`CLAUDE.md` B.3）：它是 UI 的投影，
 * 别的地方（比如图标、排序）会有各自不同的表，不该共用一个。
 */
const STATUS_LABEL: Readonly<Record<FileStatus, string>> = {
  [FileStatus.Unchanged]: "　",
  [FileStatus.Modified]: "改",
  [FileStatus.Added]: "增",
  [FileStatus.Deleted]: "删",
  [FileStatus.Renamed]: "名",
  [FileStatus.Copied]: "复",
  [FileStatus.TypeChanged]: "型",
};

/** `ref`：`.value` 一改，用到它的模板就重画。 */
const repo = ref<string>();
const commits = ref<Commit[]>([]);
const total = ref(0);
const selected = ref<string>();
const files = ref<CommitFileChange[]>([]);
const error = ref<string>();

/**
 * 三栏宽度。从 `viewState` 取回（收起再展开、重新加载窗口都在），拖动时存回去。
 *
 * 外层 `fixed-pane="start"`、内层 `fixed-pane="end"`：窗口或面板大小变化时，
 * 左栏和右栏保持像素宽度，只有中间的提交列表伸缩。设了 fixed-pane，组件才会自己
 * 监听尺寸变化；不设的话它不跟踪宽度，改过尺寸后第一次按下分隔线会跳位。
 */
let layout: Layout = restoreLayout(viewState.get());

function onSplit(which: keyof Layout, event: Event): void {
  const percent = splitPercent(event);
  if (percent === undefined) return;
  layout = { ...layout, [which]: percent };
  viewState.set(layout);
}

function shortHash(hash: string): string {
  return hash.slice(0, 8);
}

function when(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString();
}

function subject(message: string): string {
  const end = message.indexOf("\n");
  return end === -1 ? message : message.slice(0, end);
}

function report(cause: unknown): void {
  error.value = cause instanceof Error ? cause.message : String(cause);
}

/** 拉一屏提交。骨架 → 取前 PAGE 条的 hash → 详情。 */
async function load(repository: string): Promise<void> {
  try {
    const skeleton = await props.client.request("getSkeleton", { repo: repository });
    total.value = skeleton.length;
    const hashes = skeleton.slice(0, PAGE).map((c) => c.hash);
    commits.value = await props.client.request("getCommitDetails", { repo: repository, hashes });
    error.value = undefined;
  } catch (cause) {
    report(cause);
  }
}

async function select(hash: string): Promise<void> {
  selected.value = hash;
  try {
    if (repo.value === undefined) return;
    files.value = await props.client.request("getCommitFiles", { repo: repo.value, hash });
    error.value = undefined;
  } catch (cause) {
    report(cause);
  }
}

/** 临时：第 5 步手动验证 openDiff 用。第 11 步按「双击打开、单击跟随」重做。 */
async function openFile(file: CommitFileChange): Promise<void> {
  const commit = commits.value.find((c) => c.hash === selected.value);
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
    if (first === undefined) {
      error.value = "没有找到 git 仓库";
      return;
    }
    repo.value = first;
    // **只在 refs 变了才重拉提交列表。** 保存一次工作区文件只会得到 worktree，
    // 不该触发提交图重算——这是 M6 分域最主要的收益，在这里兑现。
    props.client.onDomainsChanged((_changed, domains) => {
      if (domains.includes(GitDomain.Refs)) void load(first);
    });
    await load(first);
  } catch (cause) {
    report(cause);
  }
});
</script>

<template>
  <vscode-split-layout
    class="layout"
    split="vertical"
    fixed-pane="start"
    :initial-handle-position="`${layout.outer}%`"
    @vsc-split-layout-change="onSplit('outer', $event)"
  >
    <div slot="start" class="panel">
      <h2>Branches</h2>
    </div>

    <vscode-split-layout
      slot="end"
      split="vertical"
      fixed-pane="end"
      :initial-handle-position="`${layout.inner}%`"
      @vsc-split-layout-change="onSplit('inner', $event)"
    >
      <div slot="start" class="panel">
        <h2>
          提交 <span class="dim">{{ total === 0 ? "" : `共 ${total} 条，显示前 ${PAGE}` }}</span>
        </h2>
        <p v-if="error !== undefined" class="error">{{ error }}</p>
        <ul class="list">
          <li v-for="commit in commits" :key="commit.hash">
            <button
              type="button"
              :class="commit.hash === selected ? 'row selected' : 'row'"
              @click="select(commit.hash)"
            >
              <code>{{ shortHash(commit.hash) }}</code>
              <span class="subject">{{ subject(commit.message) }}</span>
              <span class="dim">{{ commit.author.name }}</span>
              <span class="dim">{{ when(commit.author.at) }}</span>
            </button>
          </li>
        </ul>
      </div>

      <div slot="end" class="panel">
        <h2>
          变更文件
          <span class="dim">{{ selected === undefined ? "（未选择）" : shortHash(selected) }}</span>
        </h2>
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
