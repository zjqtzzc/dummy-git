<script setup lang="ts">
import { assertNever } from "@dummy-git/shared";
import { AppIcon, appIcon, IconSize } from "../logic/icons.js";
import { FilterKind } from "../logic/log/filter.js";
import Icon from "../ui/Icon.vue";

/**
 * 提交列表上方的过滤栏（`.notes/design/phase-5.md` 第 1 条）：左边搜索框，右边四个按钮。
 * 按钮没生效时只写名字加 ▾；生效后写当前值，后面一个 × 清除。值怎么选、怎么写由使用方定，这里只摆。
 */
defineProps<{
  /** 生效中的条件，按钮上显示的值。缺席的就是没生效。 */
  values: Readonly<Partial<Record<FilterKind, string>>>;
}>();
const emit = defineEmits<{
  /** 点了按钮：选一个值。 */
  open: [kind: FilterKind];
  /** 点了 ×：清除这一种条件。 */
  clear: [kind: FilterKind];
}>();

const KINDS: readonly FilterKind[] = [FilterKind.Branch, FilterKind.User, FilterKind.Date, FilterKind.Paths];

function nameOf(kind: FilterKind): string {
  switch (kind) {
    case FilterKind.Branch:
      return "Branch";
    case FilterKind.User:
      return "User";
    case FilterKind.Date:
      return "Date";
    case FilterKind.Paths:
      return "Paths";
    default:
      return assertNever(kind, "nameOf");
  }
}
</script>

<template>
  <div class="filter-bar">
    <label class="search">
      <Icon :icon="appIcon(AppIcon.Search)" :size="IconSize.Inline" />
      <input type="text" placeholder="Text or hash" aria-label="Search by text or hash" />
    </label>
    <template v-for="kind in KINDS" :key="kind">
      <span v-if="values[kind] === undefined" class="filter">
        <button type="button" class="pick" @click="emit('open', kind)">
          {{ nameOf(kind) }}
          <Icon :icon="appIcon(AppIcon.Dropdown)" :size="IconSize.Inline" />
        </button>
      </span>
      <span v-else class="filter active">
        <button type="button" class="pick" @click="emit('open', kind)">
          {{ nameOf(kind) }}: {{ values[kind] }}
        </button>
        <button
          type="button"
          class="clear"
          :title="`Clear ${nameOf(kind)} filter`"
          :aria-label="`Clear ${nameOf(kind)} filter`"
          @click="emit('clear', kind)"
        >
          <Icon :icon="appIcon(AppIcon.Close)" :size="IconSize.Inline" />
        </button>
      </span>
    </template>
  </div>
</template>

<style scoped>
.filter-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 6px;
  border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, transparent);
}
/* 搜索框占满剩余宽度，窄时它先缩；按钮文字不截断。 */
.search {
  flex: 1;
  min-width: 60px;
  display: flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 4px;
  border: 1px solid var(--vscode-input-border, transparent);
  border-radius: 2px;
  background: var(--vscode-input-background);
  color: var(--vscode-input-placeholderForeground);
}
.search:focus-within {
  border-color: var(--vscode-focusBorder);
}
.search input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: none;
  color: var(--vscode-input-foreground);
  font: inherit;
}
.filter {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  border-radius: 4px;
}
.filter.active {
  background: var(--vscode-toolbar-activeBackground, var(--vscode-toolbar-hoverBackground));
}
.pick,
.clear {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 22px;
  padding: 0 6px;
  border: none;
  border-radius: 4px;
  background: none;
  color: var(--vscode-foreground);
  font: inherit;
  white-space: nowrap;
  cursor: pointer;
}
.clear {
  padding: 0 3px;
  color: var(--vscode-icon-foreground);
}
.pick:hover,
.clear:hover {
  background: var(--vscode-toolbar-hoverBackground);
}
.pick:focus-visible,
.clear:focus-visible {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: -1px;
}
</style>
