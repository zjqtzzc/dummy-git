<script setup lang="ts">
import { DialogKind } from "@dummy-git/shared";
import { onMounted, ref } from "vue";
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

/** 点了就关，推送在后台跑；进度与结果由扩展的进度出口、错误关口显示。 */
function push(): void {
  if (repo.value === undefined || target.value === undefined) return;
  props.client
    .request("push", { repo: repo.value, branch: props.subject, ...target.value })
    .catch(report);
  close();
}
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
      <vscode-button @click="push">Push</vscode-button>
    </template>
  </DialogShell>
</template>
