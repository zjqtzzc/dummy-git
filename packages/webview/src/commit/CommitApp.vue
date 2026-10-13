<script setup lang="ts">
import { DiffOpenMode, GitDomain, type OngoingOperation } from "@dummy-git/shared";
import { VscodeCheckbox } from "@vscode-elements/elements/dist/vscode-checkbox/vscode-checkbox.js";
import { VscodeTextarea } from "@vscode-elements/elements/dist/vscode-textarea/vscode-textarea.js";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { type Client, report } from "../logic/client.js";
import { commitMessage, isBlankMessage } from "../logic/commit/message.js";
import { MessageUpdate, messageUpdate } from "../logic/commit/operationMessage.js";
import {
  CONFLICTS_GROUP,
  type ConflictFile,
  conflictFiles,
  conflictHeading,
  opensMergeEditor,
  type WorkingFile,
  WorkingStatus,
  workingDiffSides,
  workingFiles,
  workingGroups,
} from "../logic/commit/workingChanges.js";
import { AppIcon, appIcon, codicon } from "../logic/icons.js";
import { type FileEntry, groupNodeId, keepChecked } from "../logic/tree/fileTree.js";
import FileTree from "../tree/FileTree.vue";
import Icon from "../ui/Icon.vue";
import ToolButton from "../ui/ToolButton.vue";
import { viewState } from "../vscodeApi.js";
import StashView from "./StashView.vue";

/**
 * 侧栏 Commit 面板（`.notes/design/phase-2.md` 第二节第 2 条）。
 *
 * 从上到下：Commit / Stash 切换、工具栏、文件树、底部固定区（Amend、说明、提交）。
 * Stash 模式（`StashView`）只换掉切换栏以下的部分，底部固定区不显示。
 * 文件树占满中间，底部固定区始终贴底。
 */
const props = defineProps<{ client: Client }>();

enum Mode {
  Commit = "commit",
  Stash = "stash",
}
/** 顶部切换栏：Commit 模式（提交、存 stash）与 Stash 模式（看、取回 stash）。 */
const mode = ref(Mode.Commit);

const repo = ref<string>();
/** HEAD 的完整 hash，diff 左边用。还没有任何提交时缺席。 */
const head = ref<string>();
const files = ref<WorkingFile[]>([]);
const tree = ref<InstanceType<typeof FileTree>>();
const loaded = ref(false);
/** 冲突文件：单独成组，不能勾。 */
const conflicts = ref<ConflictFile[]>([]);
/** 停在半路的操作。没有是 `null`（stash 取出冲突也是 `null`）。 */
const operation = ref<OngoingOperation | null>(null);
const groups = computed(() =>
  workingGroups(repo.value ?? "", conflicts.value, files.value, operation.value),
);
const heading = computed(() => conflictHeading(operation.value, conflicts.value.length));
/** 有没有任何要显示的文件（冲突也算）。停在半路时标题行也要画，哪怕文件已经清完。 */
const hasFiles = computed(
  () => files.value.length > 0 || conflicts.value.length > 0 || operation.value !== null,
);
const conflictRow = groupNodeId(CONFLICTS_GROUP);

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
/**
 * 不把 `message` 绑在元素的 `value` 上。这个组件每次重画都会把 `value` 再写进去，
 * 自定义元素会拿这次写入重置内部文字——文件列表一刷新，刚改的说明就没了。
 * 只在说明和框里的字不一样时才写进去。
 */
const messageBox = ref<VscodeTextarea>();
watch([messageBox, message], () => {
  const box = messageBox.value;
  if (box === undefined || box.value === message.value) return;
  box.value = message.value;
});
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
  const box = event.currentTarget;
  if (!(box instanceof VscodeTextarea)) return;
  // 读里面那个真正的输入框。宿主上的 value 在这次输入之后不一定已经跟上。
  message.value = box.wrappedElement.value;
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
/** 正在 Rollback。提交与 Rollback 进行中，两个按钮都置灰（第二节第 12 条）。 */
const rollingBack = ref(false);
/** 正在存 stash。同上，和提交、Rollback 互相置灰。 */
const stashing = ref(false);
const busy = computed(() => committing.value || rollingBack.value || stashing.value);
/**
 * 说明为空（只有空白也算）不能提交；普通提交还要至少勾一个文件，
 * Amend 不勾文件也行（只改说明）。
 */
const canCommit = computed(
  () =>
    !busy.value &&
    operation.value === null &&
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

/**
 * Rollback 只管已跟踪的改动：勾选里一个已跟踪文件都没有时置灰（第二节第 9 条）。
 * 未跟踪文件用第 7 阶段右键菜单的 Delete。
 */
const canRollback = computed(
  () =>
    !busy.value &&
    files.value.some((file) => file.status !== WorkingStatus.Untracked && checked.value.has(file.path)),
);

/** 确认框由扩展弹；勾选里的未跟踪文件扩展会跳过。失败由错误关口报。 */
async function rollbackChecked(): Promise<void> {
  if (repo.value === undefined || !canRollback.value) return;
  rollingBack.value = true;
  try {
    await props.client.request("rollback", { repo: repo.value, paths: [...checked.value] });
  } catch (cause) {
    report(cause);
  } finally {
    rollingBack.value = false;
  }
}

/** 有改动就能存：勾了文件存勾选的，什么都没勾存全部。 */
const canStash = computed(() => !busy.value && files.value.length > 0);

/** 存 stash：路径为空时扩展存全部改动。完成消息由扩展显示在状态栏，失败由错误关口报。 */
async function stashChecked(): Promise<void> {
  if (repo.value === undefined || !canStash.value) return;
  stashing.value = true;
  try {
    await props.client.request("stash", { repo: repo.value, paths: [...checked.value] });
  } catch (cause) {
    report(cause);
  } finally {
    stashing.value = false;
  }
}

/** 说明框里 Ctrl+Enter（Mac 上 Cmd+Enter）= 点 Commit 按钮。快捷键只有这一个（第二节第 11 条）。 */
function onMessageKeydown(event: KeyboardEvent): void {
  if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey)) return;
  event.preventDefault();
  void submit();
}

/**
 * 上一停的身份。`undefined` 是还没读过：第一次读到没有操作时，不覆盖面板里存着的说明。
 * 存进 `viewState`：这个视图收起再展开会整页重建，内存里的身份没了，
 * 不存的话下一次读会被当成第一次，把改过的说明盖掉。
 * 进入一停（或换到下一条提交）时：取消 Amend、丢掉草稿、说明换成 git 准备的。
 * 操作结束时清空说明，同提交成功。
 */
let seenOperation = savedOperationId();
function savedOperationId(): string | null | undefined {
  const saved = viewState.read("operationId");
  return typeof saved === "string" || saved === null ? saved : undefined;
}
function applyOperation(next: OngoingOperation | null): void {
  const id = next?.id ?? null;
  const previous = seenOperation;
  operation.value = next;
  if (seenOperation !== id) {
    seenOperation = id;
    viewState.write("operationId", id);
  }
  const action = messageUpdate(previous, id);
  if (action === MessageUpdate.Fill && next !== null) fillOperationMessage(next);
  if (action === MessageUpdate.Clear) clearMessage();
}
function fillOperationMessage(next: OngoingOperation): void {
  amend.value = false;
  draft.value = "";
  message.value = next.message;
  save();
}
function clearMessage(): void {
  amend.value = false;
  draft.value = "";
  message.value = "";
  save();
}

const operating = ref(false);
async function continueOp(): Promise<void> {
  if (repo.value === undefined || heading.value?.canContinue !== true || operating.value) return;
  operating.value = true;
  try {
    await props.client.request("continueOperation", {
      repo: repo.value,
      message: commitMessage(message.value),
    });
  } catch (cause) {
    report(cause);
  } finally {
    operating.value = false;
  }
}
async function abortOp(): Promise<void> {
  if (repo.value === undefined || heading.value?.actions !== true || operating.value) return;
  operating.value = true;
  try {
    await props.client.request("abortOperation", { repo: repo.value });
  } catch (cause) {
    report(cause);
  } finally {
    operating.value = false;
  }
}

/**
 * 最近一次请求的序号。`git status` 不排队、可以并发，先发的可能后回来；
 * 只收最新那次的结果，免得旧结果盖掉新的。
 */
let latest = 0;
async function load(repo: string): Promise<void> {
  const mine = ++latest;
  try {
    const [status, op] = await Promise.all([
      props.client.request("getStatus", { repo }),
      props.client.request("getOperation", { repo }),
    ]);
    if (mine !== latest) return;
    head.value = status.head;
    files.value = workingFiles(status.changes);
    conflicts.value = conflictFiles(status.changes);
    applyOperation(op);
    setChecked(keepChecked(checked.value, groups.value));
    loaded.value = true;
  } catch (cause) {
    report(cause);
  }
}

/** 双击或回车打开，单击或上下键跟随（由 `mode` 区分）。 */
async function openFile(entry: FileEntry, mode: DiffOpenMode): Promise<void> {
  if (repo.value === undefined) return;
  const conflict = conflicts.value.find((f) => f.path === entry.path);
  if (conflict !== undefined) {
    // 冲突文件只在双击时打开合并编辑器：单击跟随会让它一点就弹出来。
    if (mode !== DiffOpenMode.Open) return;
    // 两边都有内容的进合并编辑器；一边删了的、两边都删了的，扩展弹框选保留或删除。
    const command = opensMergeEditor(conflict.conflict) ? "openMergeEditor" : "resolveDeletion";
    try {
      await props.client.request(command, { repo: repo.value, path: entry.path });
    } catch (cause) {
      report(cause);
    }
    return;
  }
  const file = files.value.find((f) => f.path === entry.path);
  if (file === undefined) return;
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
      if (
        domains.includes(GitDomain.Worktree) ||
        domains.includes(GitDomain.Refs) ||
        domains.includes(GitDomain.Operation)
      ) {
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
      <button
        type="button"
        :class="['mode', { active: mode === Mode.Commit }]"
        @click="mode = Mode.Commit"
      >
        Commit
      </button>
      <button
        type="button"
        :class="['mode', { active: mode === Mode.Stash }]"
        @click="mode = Mode.Stash"
      >
        Stash
      </button>
    </div>

    <StashView v-show="mode === Mode.Stash" :client="client" :repo="repo" />

    <div v-show="mode === Mode.Commit" class="commit-mode">

    <div class="toolbar">
      <ToolButton
        :icon="codicon('discard')"
        title="Rollback"
        :disabled="!canRollback"
        @click="rollbackChecked"
      />
      <ToolButton
        :icon="appIcon(AppIcon.Stash)"
        :title="checked.size > 0 ? 'Stash Selected' : 'Stash All'"
        :disabled="!canStash"
        @click="stashChecked"
      />
      <!-- 没有改动时置灰（第二节第 13 条）。 -->
      <ToolButton
        :icon="appIcon(AppIcon.ExpandAll)"
        title="Expand All"
        :disabled="!hasFiles"
        @click="tree?.expandAll()"
      />
      <ToolButton
        :icon="appIcon(AppIcon.CollapseAll)"
        title="Collapse All"
        :disabled="!hasFiles"
        @click="tree?.collapseAll()"
      />
    </div>

    <div class="files">
      <p v-if="!loaded" class="dim note">Loading…</p>
      <p v-else-if="!hasFiles" class="dim note">No changes</p>
      <FileTree
        v-else
        ref="tree"
        :groups="groups"
        :checked="checked"
        @check="onCheck"
        @open="openFile"
      >
        <template v-if="heading?.actions" #after="{ node }">
          <span v-if="node.id === conflictRow" class="ops">
            <button
              type="button"
              class="op"
              :disabled="!heading.canContinue || operating"
              :title="heading.canContinue ? 'Continue' : 'Resolve conflicts first'"
              @click="continueOp"
            >
              <Icon :icon="codicon('arrow-right')" />
            </button>
            <button
              type="button"
              class="op abort"
              title="Abort"
              :disabled="operating"
              @click="abortOp"
            >
              <Icon :icon="codicon('close')" />
            </button>
          </span>
        </template>
      </FileTree>
    </div>

    <div class="footer">
      <!-- 还没有任何提交时没有可改的，置灰（第二节第 8 条）。 -->
      <vscode-checkbox
        label="Amend"
        :checked="amend"
        :disabled="head === undefined || operation !== null"
        @change="onAmendChange"
      />
      <vscode-textarea
        ref="messageBox"
        class="message"
        rows="4"
        resize="vertical"
        placeholder="Commit Message"
        @input="onInput"
        @keydown="onMessageKeydown"
      />
      <vscode-button :disabled="!canCommit" @click="submit">{{
        committing ? "Committing…" : "Commit"
      }}</vscode-button>
    </div>
    </div>
  </div>
</template>

<style scoped>
.commit-app {
  height: 100vh;
  display: flex;
  flex-direction: column;
}
.commit-mode {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
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
.ops {
  display: flex;
  align-items: center;
  gap: 4px;
}
.op {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: #1f883d;
  color: #fff;
  cursor: pointer;
}
.op:hover:not(:disabled) {
  background: #2da44e;
}
.op:active:not(:disabled) {
  background: #116329;
}
.op.abort {
  background: #cf222e;
}
.op.abort:hover:not(:disabled) {
  background: #e5534b;
}
.op.abort:active:not(:disabled) {
  background: #a40e26;
}
.op:focus-visible {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: -1px;
}
.op:disabled {
  opacity: 0.35;
  cursor: default;
}
</style>
