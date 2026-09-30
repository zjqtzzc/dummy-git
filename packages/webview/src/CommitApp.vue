<script setup lang="ts">
/**
 * 侧栏 Commit 面板（`.notes/design/phase-2.md` 第二节第 2 条）。
 *
 * 从上到下：Commit / Stash 切换、工具栏、文件树、底部固定区（Amend、说明、提交）。
 * 文件树占满中间，底部固定区始终贴底。现在只有布局，各部分在后面几步接上。
 */
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
      <vscode-toolbar-button icon="expand-all" label="Expand All" />
      <vscode-toolbar-button icon="collapse-all" label="Collapse All" />
    </vscode-toolbar-container>

    <div class="files" />

    <div class="footer">
      <vscode-checkbox label="Amend" />
      <vscode-textarea class="message" rows="4" resize="vertical" placeholder="Commit Message" />
      <vscode-button>Commit</vscode-button>
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
.files {
  flex: 1;
  min-height: 0;
  overflow: auto;
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
