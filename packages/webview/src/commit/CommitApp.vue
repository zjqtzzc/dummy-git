<script setup lang="ts">
import { type DiffOpenMode, GitDomain } from "@dummy-git/shared";
import { computed, onMounted, ref } from "vue";
import { type Client, report } from "../logic/client.js";
import {
  type WorkingFile,
  workingDiffSides,
  workingFiles,
  workingGroups,
} from "../logic/commit/workingChanges.js";
import { type FileEntry, keepChecked } from "../logic/tree/fileTree.js";
import FileTree from "../tree/FileTree.vue";
import { viewState } from "../vscodeApi.js";

/**
 * 侧栏 Commit 面板（`.notes/design/phase-2.md` 第二节第 2 条）。
 *
 * 从上到下：Commit / Stash 切换、工具栏、文件树、底部固定区（Amend、说明、提交）。
 * 文件树占满中间，底部固定区始终贴底。
 */
const props = defineProps<{ client: Client }>();

const repo = ref<string>();
/** HEAD 的完整 hash，diff 左边用。还没有任何提交时缺席。 */
const head = ref<string>();
const files = ref<WorkingFile[]>([]);
const loaded = ref(false);
const groups = computed(() => workingGroups(files.value));

/**
 * 勾选的路径。默认都不勾（第二节第 4 条）。存进 `viewState`：面板收起再展开、重新加载窗口都还在。
 */
const checked = ref<ReadonlySet<string>>(new Set(restoreChecked(viewState.read("checked"))));
function restoreChecked(saved: unknown): string[] {
  return Array.isArray(saved) ? saved.filter((path) => typeof path === "string") : [];
}
function setChecked(next: ReadonlySet<string>): void {
  checked.value = next;
  viewState.write("checked", [...next]);
}
function onCheck(paths: readonly string[], value: boolean): void {
  const next = new Set(checked.value);
  for (const path of paths) {
    if (value) next.add(path);
    else next.delete(path);
  }
  setChecked(next);
}

/**
 * 最近一次请求的序号。`git status` 不排队、可以并发，先发的可能后回来；
 * 只收最新那次的结果，免得旧结果盖掉新的。
 */
let latest = 0;
async function load(repo: string): Promise<void> {
  const mine = ++latest;
  try {
    const status = await props.client.request("getStatus", { repo });
    if (mine !== latest) return;
    head.value = status.head;
    files.value = workingFiles(status.changes);
    setChecked(keepChecked(checked.value, groups.value));
    loaded.value = true;
  } catch (cause) {
    report(cause);
  }
}

/** 双击或回车打开，单击或上下键跟随（由 `mode` 区分）。 */
async function openFile(entry: FileEntry, mode: DiffOpenMode): Promise<void> {
  const file = files.value.find((f) => f.path === entry.path);
  if (repo.value === undefined || file === undefined) return;
  const { left, right } = workingDiffSides(head.value, file);
  try {
    await props.client.request("openDiff", { repo: repo.value, left, right, mode });
  } catch (cause) {
    report(cause);
  }
}

onMounted(async () => {
  props.client.start();
  try {
    const roots = await props.client.request("getRepositories", {});
    const first = roots[0];
    if (first === undefined) return;
    repo.value = first;
    // 工作区与暂存区的变化归 worktree 域；HEAD 移动归 refs 域（diff 左边要跟着换）。
    props.client.onDomainsChanged((_changed, domains) => {
      if (domains.includes(GitDomain.Worktree) || domains.includes(GitDomain.Refs)) {
        void load(first);
      }
    });
    await load(first);
  } catch (cause) {
    report(cause);
  }
});
</script>

<template>
  <div class="commit-app">
    <div class="modes">
      <button type="button" class="mode active">Commit</button>
      <!-- 第 4 阶段接上。先占位：它决定顶部的高度。 -->
      <button type="button" class="mode" disabled>Stash</button>
    </div>

    <vscode-toolbar-container class="toolbar">
      <vscode-toolbar-button icon="discard" label="Rollback" />
      <vscode-toolbar-button icon="expand-all" label="Expand All" />
      <vscode-toolbar-button icon="collapse-all" label="Collapse All" />
    </vscode-toolbar-container>

    <div class="files">
      <p v-if="!loaded" class="dim note">Loading…</p>
      <p v-else-if="files.length === 0" class="dim note">No changes</p>
      <FileTree v-else :groups="groups" :checked="checked" @check="onCheck" @open="openFile" />
    </div>

    <div class="footer">
      <vscode-checkbox label="Amend" />
      <vscode-textarea class="message" rows="4" resize="vertical" placeholder="Commit Message" />
      <vscode-button>Commit</vscode-button>
    </div>
  </div>
</template>

<style scoped>
.commit-app {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--vscode-sideBar-background);
}
.modes {
  display: flex;
  gap: 4px;
  padding: 6px 8px 2px;
}
.mode {
  padding: 2px 8px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: none;
  color: var(--vscode-foreground);
  font: inherit;
  cursor: pointer;
}
.mode.active {
  border-color: var(--vscode-focusBorder);
}
.mode:disabled {
  color: var(--vscode-disabledForeground);
  cursor: default;
}
.toolbar {
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
.footer {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 8px;
  border-top: 1px solid var(--vscode-sideBarSectionHeader-border, transparent);
}
.message {
  width: 100%;
}
</style>
