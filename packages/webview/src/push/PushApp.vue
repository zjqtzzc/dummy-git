<script setup lang="ts">
import { DialogKind } from "@dummy-git/shared";
import { onMounted } from "vue";
import { type Client, report } from "../logic/client.js";
import DialogShell from "../ui/DialogShell.vue";

/** 推送对话框（`.notes/design/phase-10.md`）。`subject` 是要推的本地分支。 */
const props = defineProps<{ client: Client; subject: string }>();

onMounted(() => props.client.start());

function cancel(): void {
  props.client.request("closeDialog", { dialog: DialogKind.Push }).catch(report);
}
</script>

<template>
  <DialogShell
    :title="`Push ${subject}`"
    :description="`Push commits from ${subject} to a remote branch.`"
  >
    <template #buttons>
      <vscode-button secondary @click="cancel">Cancel</vscode-button>
      <vscode-button>Push</vscode-button>
    </template>
  </DialogShell>
</template>
