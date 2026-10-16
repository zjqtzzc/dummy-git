<script setup lang="ts">
import { DialogKind, RefKind } from "@dummy-git/shared";
import { VscodeTextarea } from "@vscode-elements/elements/dist/vscode-textarea/vscode-textarea.js";
import { onMounted, ref } from "vue";
import { type Client, report } from "../logic/client.js";
import { isBlankMessage } from "../logic/commit/message.js";
import DialogShell from "../ui/DialogShell.vue";

/** 改一条提交的说明。`subject` 是那条提交的完整 hash。 */
const props = defineProps<{ client: Client; subject: string }>();

const repo = ref<string>();
/** 说明行 `<短 hash> on <分支>`。取到之前只有短 hash。 */
const where = ref(props.subject.slice(0, 7));
/** 原来的说明，与输入框里正在改的。取到之前缺席。 */
const original = ref<string>();
const message = ref("");

onMounted(async () => {
  props.client.start();
  try {
    const [root] = await props.client.request("getRepositories", {});
    if (root === undefined) return;
    repo.value = root;
    const [[commit], refs] = await Promise.all([
      props.client.request("getCommitDetails", { repo: root, hashes: [props.subject] }),
      props.client.request("getRefs", { repo: root }),
    ]);
    const head = refs.find((r) => r.kind === RefKind.Head);
    where.value = `${props.subject.slice(0, 7)} on ${head?.branch ?? "HEAD"}`;
    if (commit === undefined) return;
    original.value = commit.message;
    message.value = commit.message;
  } catch (cause) {
    report(cause);
  }
});

function onInput(event: Event): void {
  // 读里面那个真正的输入框：宿主上的 value 在这次输入之后不一定已经跟上。
  if (event.currentTarget instanceof VscodeTextarea) {
    message.value = event.currentTarget.wrappedElement.value;
  }
}

function close(): void {
  props.client.request("closeDialog", { dialog: DialogKind.Reword }).catch(report);
}

/** 空说明点了没反应；没改就直接关。改写前扩展关掉对话框，进度与结果走进度出口、错误关口。 */
function reword(): void {
  if (repo.value === undefined || isBlankMessage(message.value)) return;
  if (message.value === original.value) {
    close();
    return;
  }
  props.client
    .request("reword", { repo: repo.value, hash: props.subject, message: message.value })
    .catch(report);
}
</script>

<template>
  <DialogShell title="Edit Commit Message" :description="where">
    <vscode-textarea
      v-if="original !== undefined"
      class="message"
      rows="12"
      resize="vertical"
      :value="original"
      @input="onInput"
    />
    <template #buttons>
      <vscode-button secondary @click="close">Cancel</vscode-button>
      <vscode-button @click="reword">Reword</vscode-button>
    </template>
  </DialogShell>
</template>

<style scoped>
.message {
  box-sizing: border-box;
  width: 100%;
  margin: 8px 0;
}
</style>
