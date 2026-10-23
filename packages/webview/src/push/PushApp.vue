<script setup lang="ts">
import { type Commit, DialogKind, PushTagMode, type Ref } from "@dummy-git/shared";
import { VscodeSingleSelect } from "@vscode-elements/elements/dist/vscode-single-select/vscode-single-select.js";
import { VscodeTextfield } from "@vscode-elements/elements/dist/vscode-textfield/vscode-textfield.js";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { type Client, report } from "../logic/client.js";
import { isNewRemoteBranch } from "../logic/push/target.js";
import { CheckState } from "../logic/tree/tree.js";
import { formatTime } from "../logic/utils/time.js";
import CheckBox from "../ui/CheckBox.vue";
import DialogShell from "../ui/DialogShell.vue";

/** 推送对话框。`subject` 是要推的本地分支。 */
const props = defineProps<{ client: Client; subject: string }>();

const repo = ref<string>();
const remotes = ref<readonly string[]>([]);
/**
 * 推到哪个远程、远程上的哪个分支。打开时填默认目标，用户可改。空串表示还没取到（取不到时扩展已经报过为什么）。
 * 仓库一个远程都没有时，`remote` 是要定义的远程的名字（预填 `origin`）。
 */
const remote = ref("");
const remoteBranch = ref("");
/** 仓库一个远程都没有：远程下拉换成名字与地址两个输入框，推送前先加这个远程。 */
const defining = computed(() => remote.value !== "" && remotes.value.length === 0);
const remoteUrl = ref("");
/**
 * 这次打开要不要一起推 tag。默认不推，关掉重开也不保留：
 * 推 tag 比推分支少，记住的话下一次会把本地 tag 一起推上去。
 */
const pushTags = ref(false);
/** 勾上时推哪些。没勾时下拉置灰，选中项留着。 */
const tagMode = ref(PushTagMode.All);
/** 下拉两项的文案，书写顺序就是显示顺序。 */
const TAG_LABEL: Record<PushTagMode, string> = {
  [PushTagMode.All]: "All",
  [PushTagMode.Follow]: "Current Branch",
};
/** 打开时的分支与 tag，只用来判断目标是不是新分支。 */
const refs = ref<readonly Ref[]>([]);
const isNew = computed(() => isNewRemoteBranch(refs.value, remote.value, remoteBranch.value));

onMounted(async () => {
  props.client.start();
  try {
    const [root] = await props.client.request("getRepositories", {});
    if (root === undefined) return;
    repo.value = root;
    const [target, all] = await Promise.all([
      props.client.request("getPushTarget", { repo: root, branch: props.subject }),
      props.client.request("getRefs", { repo: root }),
    ]);
    remotes.value = target.remotes;
    remote.value = target.remote;
    remoteBranch.value = target.remoteBranch;
    refs.value = all;
  } catch (cause) {
    report(cause);
  }
});

/** 要推的提交，最新的在前；`more` 是还有没列出的。还没取到时缺席。 */
const outgoing = ref<{ commits: Commit[]; more: boolean }>();
/** 取到列表时的时间（unix 秒），日期列按它写「多久之前」。 */
const now = ref(0);
/** 每次改目标都重新取。边输入边取时回复可能乱序，只认最后一次的。 */
let asked = 0;
async function loadOutgoing(): Promise<void> {
  if (repo.value === undefined || remote.value === "") return;
  const ask = ++asked;
  const result = await props.client.request("getOutgoingCommits", {
    repo: repo.value,
    branch: props.subject,
    remote: remote.value,
    remoteBranch: remoteBranch.value,
  });
  if (ask !== asked) return;
  now.value = Math.floor(Date.now() / 1000);
  outgoing.value = result;
}
watch([remote, remoteBranch], () => {
  loadOutgoing().catch(report);
});

function onRemote(event: Event): void {
  if (event.currentTarget instanceof VscodeSingleSelect) remote.value = event.currentTarget.value;
}
/** 输入框里的文字。读里面那个真正的输入框：宿主上的 value 在这次输入之后不一定已经跟上。 */
function textOf(event: Event): string | undefined {
  return event.currentTarget instanceof VscodeTextfield
    ? event.currentTarget.wrappedElement.value
    : undefined;
}
function onRemoteName(event: Event): void {
  remote.value = textOf(event) ?? remote.value;
}
function onRemoteBranch(event: Event): void {
  remoteBranch.value = textOf(event) ?? remoteBranch.value;
}
function onRemoteUrl(event: Event): void {
  remoteUrl.value = textOf(event) ?? remoteUrl.value;
}
/** 下拉的值来自控件，只认我们放进去的两项。 */
function onTagMode(event: Event): void {
  if (!(event.currentTarget instanceof VscodeSingleSelect)) return;
  const value = event.currentTarget.value;
  switch (value) {
    case PushTagMode.All:
    case PushTagMode.Follow:
      tagMode.value = value;
      return;
    default:
      return;
  }
}

function close(): void {
  props.client.request("closeDialog", { dialog: DialogKind.Push }).catch(report);
}

/**
 * 扩展推送前关掉对话框，推送在后台跑；进度与结果由扩展的进度出口、错误关口显示。
 * `force` 时扩展先确认，取消了对话框留着。远程分支名不合法时由 git 报错。
 */
function push(force: boolean): void {
  if (repo.value === undefined || remote.value === "") return;
  if (defining.value && remoteUrl.value === "") return;
  const target = {
    repo: repo.value,
    branch: props.subject,
    remote: remote.value,
    remoteBranch: remoteBranch.value,
    force,
    // 没勾就不带：不推 tag，和「带了但模式不对」是两回事。
    ...(pushTags.value ? { tags: tagMode.value } : {}),
  };
  props.client
    .request("push", defining.value ? { ...target, remoteUrl: remoteUrl.value } : target)
    .catch(report);
}

/**
 * Push 右边 `▾` 弹出的更多动作（Force Push）。浮层画在 webview 里出不了标签页，
 * 所以往上开、右边对齐：按钮栏贴底，上方是内容区，有空间。
 * 点了里面的动作、点浮层外面、按 Esc、webview 失去焦点，都收起。
 */
const optionsOpen = ref(false);
const split = ref<HTMLElement>();
const options = ref<HTMLElement>();

function onPointerDown(event: PointerEvent): void {
  if (event.target instanceof Node && split.value?.contains(event.target)) return;
  optionsOpen.value = false;
}
/** 点了浮层里的动作：动作自己的 click 先跑，冒泡到这里再收起。 */
function onClick(event: MouseEvent): void {
  if (event.target instanceof Node && options.value?.contains(event.target)) {
    optionsOpen.value = false;
  }
}
function onKeydown(event: KeyboardEvent): void {
  if (!optionsOpen.value || event.key !== "Escape") return;
  optionsOpen.value = false;
  event.preventDefault();
}
function onBlur(): void {
  optionsOpen.value = false;
}

onMounted(() => {
  document.addEventListener("pointerdown", onPointerDown);
  document.addEventListener("click", onClick);
  document.addEventListener("keydown", onKeydown);
  window.addEventListener("blur", onBlur);
});
onUnmounted(() => {
  document.removeEventListener("pointerdown", onPointerDown);
  document.removeEventListener("click", onClick);
  document.removeEventListener("keydown", onKeydown);
  window.removeEventListener("blur", onBlur);
});
</script>

<template>
  <DialogShell
    :title="`Push ${subject}`"
    :description="`Push commits from ${subject} to a remote branch.`"
  >
    <div v-if="remote !== ''" class="field">
      <span class="label dim">Target</span>
      <div class="control">
        <span>{{ subject }} →</span>
        <vscode-textfield
          v-if="defining"
          class="remote"
          placeholder="Name"
          :value="remote"
          @input="onRemoteName"
        />
        <vscode-single-select v-else class="remote" :value="remote" @change="onRemote">
          <vscode-option v-for="name in remotes" :key="name" :value="name">{{ name }}</vscode-option>
        </vscode-single-select>
        <span class="dim">/</span>
        <vscode-textfield class="grow" :value="remoteBranch" @input="onRemoteBranch" />
        <vscode-badge v-if="isNew">New</vscode-badge>
      </div>
    </div>
    <div v-if="defining" class="field">
      <span class="label dim">Remote URL</span>
      <div class="control">
        <vscode-textfield class="grow" :value="remoteUrl" @input="onRemoteUrl" />
      </div>
    </div>
    <div v-if="outgoing !== undefined" class="outgoing">
      <div class="dim">
        Commits ({{ outgoing.commits.length }}{{ outgoing.more ? "+" : "" }})
      </div>
      <div class="commits">
        <div v-for="commit in outgoing.commits" :key="commit.hash" class="commit">
          <span class="subject">{{ commit.message.split("\n", 1)[0] }}</span>
          <span class="dim">{{ commit.author.name }}</span>
          <span class="dim">{{ formatTime(commit.author.at, now) }}</span>
        </div>
        <div v-if="outgoing.commits.length === 0" class="commit dim">No commits to push</div>
      </div>
    </div>
    <div v-if="remote !== ''" class="field">
      <span class="label dim">Tags</span>
      <div class="control">
        <CheckBox
          label="Push tags"
          :state="pushTags ? CheckState.Checked : CheckState.Unchecked"
          @toggle="pushTags = !pushTags"
        />
        <vscode-single-select
          class="tag-mode"
          :value="tagMode"
          :disabled="!pushTags"
          @change="onTagMode"
        >
          <vscode-option v-for="(label, mode) in TAG_LABEL" :key="mode" :value="mode">
            {{ label }}
          </vscode-option>
        </vscode-single-select>
        <span v-if="tagMode === PushTagMode.Follow" class="dim">Annotated tags only</span>
      </div>
    </div>
    <template #buttons>
      <vscode-button secondary @click="close">Cancel</vscode-button>
      <div ref="split" class="split">
        <div v-if="optionsOpen" ref="options" class="options">
          <vscode-button @click="push(true)">Force Push</vscode-button>
        </div>
        <vscode-button-group>
          <vscode-button @click="push(false)">Push</vscode-button>
          <vscode-button
            icon="chevron-down"
            title="More Actions"
            @click="optionsOpen = !optionsOpen"
          />
        </vscode-button-group>
      </div>
    </template>
  </DialogShell>
</template>

<style scoped>
/* 一行「标签 + 控件」；窄于约 480px 时上下排。 */
.field {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
}
.label {
  flex: none;
  width: 80px;
}
.control {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.remote {
  width: 120px;
}
.tag-mode {
  width: 150px;
}
.grow {
  flex: 1;
  min-width: 120px;
}
@media (max-width: 480px) {
  .field {
    flex-direction: column;
    align-items: stretch;
    gap: 4px;
  }
}
.outgoing {
  padding: 8px 0;
}
/* 只有这里会变长：给最大高度，框内滚动。 */
.commits {
  margin-top: 6px;
  max-height: 320px;
  overflow: auto;
  border: 1px solid var(--vscode-panel-border);
}
.commit {
  display: flex;
  gap: 12px;
  padding: 2px 8px;
  line-height: 22px;
  white-space: nowrap;
}
.subject {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.split {
  position: relative;
}
.options {
  position: absolute;
  right: 0;
  bottom: calc(100% + 4px);
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px;
  white-space: nowrap;
  border: 1px solid var(--vscode-editorWidget-border, transparent);
  border-radius: 4px;
  background: var(--vscode-editorWidget-background);
  box-shadow: 0 2px 8px var(--vscode-widget-shadow);
}
</style>
