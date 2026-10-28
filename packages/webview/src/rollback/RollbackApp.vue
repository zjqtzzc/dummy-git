<script setup lang="ts">
import { DialogKind, type DiffOpenMode } from "@dummy-git/shared";
import { computed, onMounted, ref } from "vue";
import { type Client, copyText, report } from "../logic/client.js";
import {
  parseDialogPaths,
  precheckedPaths,
  rollbackGroups,
  type WorkingFile,
  workingDiffSides,
  workingFiles,
} from "../logic/commit/workingChanges.js";
import { type FileRow, fileCount } from "../logic/tree/fileTree.js";
import FileTree from "../tree/FileTree.vue";
import DialogShell from "../ui/DialogShell.vue";

/** Rollback 对话框。`subject` 是预勾路径的 JSON。 */
const props = defineProps<{ client: Client; subject: string }>();

const repo = ref<string>();
const head = ref<string>();
const files = ref<WorkingFile[]>([]);
const loaded = ref(false);
const requested = parseDialogPaths(props.subject);
const checked = ref<ReadonlySet<string>>(new Set());
const groups = computed(() => rollbackGroups(files.value));
const hasChanges = computed(() => groups.value.some((group) => group.entries.length > 0));
const canRollback = computed(() => checked.value.size > 0);

onMounted(async () => {
  props.client.start();
  try {
    const [root] = await props.client.request("getRepositories", {});
    if (root === undefined) return;
    repo.value = root;
    const status = await props.client.request("getStatus", { repo: root });
    head.value = status.head;
    files.value = workingFiles(status.changes);
    checked.value = precheckedPaths(requested, files.value);
    loaded.value = true;
  } catch (cause) {
    report(cause);
  }
});

function onCheck(paths: readonly string[], value: boolean): void {
  const next = new Set(checked.value);
  for (const path of paths) {
    if (value) next.add(path);
    else next.delete(path);
  }
  checked.value = next;
}

function close(): void {
  props.client.request("closeDialog", { dialog: DialogKind.Rollback }).catch(report);
}

function rollback(): void {
  if (repo.value === undefined || !canRollback.value) return;
  props.client
    .request("rollback", { repo: repo.value, paths: [...checked.value] })
    .catch(report);
}

function onCopy(text: string): void {
  void copyText(props.client, text);
}

async function openFile(row: FileRow, mode: DiffOpenMode): Promise<void> {
  if (repo.value === undefined) return;
  const file = files.value.find((candidate) => candidate.path === row.entry.path);
  if (file === undefined) return;
  const { left, right } = workingDiffSides(head.value, file);
  try {
    await props.client.request("openDiff", { repo: repo.value, left, right, mode });
  } catch (cause) {
    report(cause);
  }
}
</script>

<template>
  <DialogShell
    title="Rollback Changes"
    description="The following files will be reset to HEAD. This cannot be undone."
  >
    <p v-if="!loaded" class="dim note">Loading…</p>
    <p v-else-if="!hasChanges" class="dim note">No changes</p>
    <div v-else class="files">
      <FileTree
        :groups="groups"
        :checked="checked"
        @check="onCheck"
        @copy="onCopy"
        @open="openFile"
      />
    </div>
    <template #status>{{ fileCount(checked.size) }}</template>
    <template #buttons>
      <vscode-button secondary @click="close">Cancel</vscode-button>
      <vscode-button :disabled="!canRollback" @click="rollback">Rollback</vscode-button>
    </template>
  </DialogShell>
</template>

<style scoped>
.files {
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
.note {
  margin: 0;
  padding-top: 24px;
  text-align: center;
}
</style>
