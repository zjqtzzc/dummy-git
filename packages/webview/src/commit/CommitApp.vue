<script setup lang="ts">
import { type DiffOpenMode, GitDomain } from "@dummy-git/shared";
import { VscodeCheckbox } from "@vscode-elements/elements/dist/vscode-checkbox/vscode-checkbox.js";
import { VscodeTextarea } from "@vscode-elements/elements/dist/vscode-textarea/vscode-textarea.js";
import { computed, onMounted, onUnmounted, ref } from "vue";
import { type Client, report } from "../logic/client.js";
import { commitMessage, isBlankMessage } from "../logic/commit/message.js";
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
const tree = ref<InstanceType<typeof FileTree>>();
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
 * 提交说明与 Amend（第二节第 7、8 条）。
 *
 * - `message`：说明框当前的内容。
 * - `amend`：是否勾着 Amend。勾上时说明框换成 HEAD 的说明（每次重新取），当前输入存为 `draft`；
 *   取消时换回 `draft`，没有就是空。Amend 时改到一半的内容不另存，下次勾上照样重新取。
 *
 * 三样都存进 `viewState`，面板隐藏、重新加载窗口原样恢复。输入时停手 300ms 存一次：
 * webview 没有可靠的「要关了」事件，不能等关闭时再存。
 */
const saved = {
  message: viewState.read("message"),
  draft: viewState.read("draft"),
  amend: viewState.read("amend"),
};
const message = ref(typeof saved.message === "string" ? saved.message : "");
const draft = ref(typeof saved.draft === "string" ? saved.draft : "");
const amend = ref(saved.amend === true);
let saving: ReturnType<typeof setTimeout> | undefined;
function save(): void {
  clearTimeout(saving);
  viewState.write("message", message.value);
  viewState.write("draft", draft.value);
  viewState.write("amend", amend.value);
}
function saveLater(): void {
  clearTimeout(saving);
  saving = setTimeout(save, 300);
}
onUnmounted(() => clearTimeout(saving));
function onInput(event: Event): void {
  if (!(event.target instanceof VscodeTextarea)) return;
  message.value = event.target.value;
  saveLater();
}

async function onAmendChange(event: Event): Promise<void> {
  if (!(event.target instanceof VscodeCheckbox)) return;
  if (!event.target.checked) {
    amend.value = false;
    message.value = draft.value;
    save();
    return;
  }
  if (repo.value === undefined || head.value === undefined) return;
  amend.value = true;
  draft.value = message.value;
  try {
    const [last] = await props.client.request("getCommitDetails", {
      repo: repo.value,
      hashes: [head.value],
    });
    message.value = last?.message ?? "";
  } catch (cause) {
    report(cause);
  }
  save();
}

/** 正在提交：按钮置灰、文字变 `Committing…`，防重复点击。 */
const committing = ref(false);
/**
 * 说明为空（只有空白也算）不能提交；普通提交还要至少勾一个文件，
 * Amend 不勾文件也行（只改说明）。
 */
const canCommit = computed(
  () =>
    !committing.value &&
    !isBlankMessage(message.value) &&
    (amend.value || checked.value.size > 0),
);

/**
 * 提交或 Amend 勾选的文件。成功不弹通知（结果本身可见），说明框与普通草稿都清空，
 * Amend 取消勾选。失败由扩展侧的错误关口报，说明与勾选原样保留，
 * 改一改就能重试（第二节第 12 条）。
 */
async function submit(): Promise<void> {
  if (repo.value === undefined || !canCommit.value) return;
  committing.value = true;
  try {
    await props.client.request(amend.value ? "amend" : "commit", {
      repo: repo.value,
      message: commitMessage(message.value),
      paths: [...checked.value],
    });
    amend.value = false;
    message.value = "";
    draft.value = "";
    save();
  } catch (cause) {
    report(cause);
  } finally {
    committing.value = false;
  }
}

/** 说明框里 Ctrl+Enter（Mac 上 Cmd+Enter）= 点 Commit 按钮。快捷键只有这一个（第二节第 11 条）。 */
function onMessageKeydown(event: KeyboardEvent): void {
  if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey)) return;
  event.preventDefault();
  void submit();
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
      <!-- 没有改动时置灰（第二节第 13 条）。这个按钮组件没有 disabled，用样式表示。 -->
      <vscode-toolbar-button
        icon="expand-all"
        label="Expand All"
        :class="{ disabled: files.length === 0 }"
        @click="tree?.expandAll()"
      />
      <vscode-toolbar-button
        icon="collapse-all"
        label="Collapse All"
        :class="{ disabled: files.length === 0 }"
        @click="tree?.collapseAll()"
      />
    </vscode-toolbar-container>

    <div class="files">
      <p v-if="!loaded" class="dim note">Loading…</p>
      <p v-else-if="files.length === 0" class="dim note">No changes</p>
      <FileTree
        v-else
        ref="tree"
        :groups="groups" :checked="checked" @check="onCheck" @open="openFile" />
    </div>

    <div class="footer">
      <!-- 还没有任何提交时没有可改的，置灰（第二节第 8 条）。 -->
      <vscode-checkbox
        label="Amend"
        :checked="amend"
        :disabled="head === undefined"
        @change="onAmendChange"
      />
      <vscode-textarea
        class="message"
        rows="4"
        resize="vertical"
        placeholder="Commit Message"
        :value="message"
        @input="onInput"
        @keydown="onMessageKeydown"
      />
      <vscode-button :disabled="!canCommit" @click="submit">{{
        committing ? "Committing…" : "Commit"
      }}</vscode-button>
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
.disabled {
  opacity: 0.4;
  pointer-events: none;
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
