<script setup lang="ts">
import { DialogKind, type DiffOpenMode, RefKind } from "@dummy-git/shared";
import { VscodeTextfield } from "@vscode-elements/elements/dist/vscode-textfield/vscode-textfield.js";
import { computed, onMounted, ref } from "vue";
import { type Client, copyText, report } from "../logic/client.js";
import {
  defaultStashMessage,
  parseDialogPaths,
  precheckedStashPaths,
  stashGroups,
  type WorkingFile,
  workingDiffSides,
  workingFiles,
} from "../logic/commit/workingChanges.js";
import { type FileRow, fileCount } from "../logic/tree/fileTree.js";
import FileTree from "../tree/FileTree.vue";
import DialogShell from "../ui/DialogShell.vue";

/** Stash 对话框。`subject` 是预勾路径的 JSON。 */
const props = defineProps<{ client: Client; subject: string }>();

const repo = ref<string>();
const head = ref<string>();
const files = ref<WorkingFile[]>([]);
const loaded = ref(false);
const requested = parseDialogPaths(props.subject);
const checked = ref<ReadonlySet<string>>(new Set());
const groups = computed(() => stashGroups(files.value));
const hasChanges = computed(() => groups.value.some((group) => group.entries.length > 0));
const canStash = computed(() => checked.value.size > 0);
/** git 不传 `-m` 时那种说明。没改（含清空）就不传 `-m`。 */
const preset = ref("");
const message = ref("");

onMounted(async () => {
  props.client.start();
  try {
    const [root] = await props.client.request("getRepositories", {});
    if (root === undefined) return;
    repo.value = root;
    const [status, refs] = await Promise.all([
      props.client.request("getStatus", { repo: root }),
      props.client.request("getRefs", { repo: root }),
    ]);
    head.value = status.head;
    files.value = workingFiles(status.changes);
    checked.value = precheckedStashPaths(requested, files.value);
    const branch = refs.find((ref) => ref.kind === RefKind.Head)?.branch;
    let subject: string | undefined;
    if (status.head !== undefined) {
      const [commit] = await props.client.request("getCommitDetails", {
        repo: root,
        hashes: [status.head],
      });
      const line = commit?.message.split("\n", 1)[0];
      subject = line === undefined ? undefined : line.trimEnd();
    }
    const wip = defaultStashMessage(branch, status.head, subject);
    preset.value = wip;
    message.value = wip;
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

function onInput(event: Event): void {
  if (event.currentTarget instanceof VscodeTextfield) {
    message.value = event.currentTarget.wrappedElement.value;
  }
}

function close(): void {
  props.client.request("closeDialog", { dialog: DialogKind.Stash }).catch(report);
}

function stash(): void {
  if (repo.value === undefined || !canStash.value) return;
  const trimmed = message.value.trim();
  const params: { repo: string; paths: readonly string[]; message?: string } = {
    repo: repo.value,
    paths: [...checked.value],
  };
  if (trimmed !== "" && trimmed !== preset.value) params.message = trimmed;
  props.client.request("stash", params).catch(report);
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
  <DialogShell title="Stash Changes" description="The following files will be stashed.">
    <p v-if="!loaded" class="dim note">Loading…</p>
    <div v-else class="layout">
      <div class="field">
        <span class="label dim">Message</span>
        <vscode-textfield class="grow" :value="message" @input="onInput" />
      </div>
      <p v-if="!hasChanges" class="dim note">No changes</p>
      <div v-else class="files">
        <FileTree
          :groups="groups"
          :checked="checked"
          @check="onCheck"
          @copy="onCopy"
          @open="openFile"
        />
      </div>
    </div>
    <template #status>{{ fileCount(checked.size) }}</template>
    <template #buttons>
      <vscode-button secondary @click="close">Cancel</vscode-button>
      <vscode-button :disabled="!canStash" @click="stash">Stash</vscode-button>
    </template>
  </DialogShell>
</template>

<style scoped>
.layout {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.field {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  flex: none;
}
.label {
  flex: none;
  width: 80px;
}
.grow {
  flex: 1;
  min-width: 0;
}
.files {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.note {
  margin: 0;
  padding-top: 24px;
  text-align: center;
}
@media (max-width: 480px) {
  .field {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
