<script setup lang="ts">
import { DialogKind } from "@dummy-git/shared";
import { onMounted, onUnmounted, ref } from "vue";
import { type Client, report } from "../logic/client.js";
import DialogShell from "../ui/DialogShell.vue";

/** 推送对话框（`.notes/design/phase-10.md`）。`subject` 是要推的本地分支。 */
const props = defineProps<{ client: Client; subject: string }>();

const repo = ref<string>();
/** 推到哪里。选不出默认目标时缺席（扩展已经报过为什么），Push 点了没反应。 */
const target = ref<{ remote: string; remoteBranch: string }>();

onMounted(async () => {
  props.client.start();
  try {
    const [root] = await props.client.request("getRepositories", {});
    if (root === undefined) return;
    repo.value = root;
    target.value = await props.client.request("getPushTarget", {
      repo: root,
      branch: props.subject,
    });
  } catch (cause) {
    report(cause);
  }
});

function close(): void {
  props.client.request("closeDialog", { dialog: DialogKind.Push }).catch(report);
}

/**
 * 扩展推送前关掉对话框，推送在后台跑；进度与结果由扩展的进度出口、错误关口显示。
 * `force` 时扩展先确认，取消了对话框留着。
 */
function push(force: boolean): void {
  if (repo.value === undefined || target.value === undefined) return;
  props.client
    .request("push", { repo: repo.value, branch: props.subject, ...target.value, force })
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
    <p v-if="target !== undefined">
      <span class="dim">Target</span>&emsp;{{ subject }} → {{ target.remote }}/{{
        target.remoteBranch
      }}
    </p>
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
