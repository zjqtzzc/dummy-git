<script setup lang="ts">
import { type Tracking, TrackingKind } from "../logic/log/branchTree.js";
import Icon from "../ui/Icon.vue";
import { AppIcon, appIcon, IconSize } from "../ui/icons.js";

/**
 * 分支名后面的同步状态，同 IDEA：蓝色 ↙ 落后（远程有、本地没有），绿色 ↗ 领先（本地有、还没推），
 * 图标与数字同色，只显示不为 0 的一边；上游已删显示灰色 gone。没有状态（`undefined`）就什么都不画。
 */
defineProps<{ state: Tracking | undefined }>();
</script>

<template>
  <template v-if="state?.kind === TrackingKind.Counts">
    <span v-if="state.behind > 0" class="count behind">
      <Icon :icon="appIcon(AppIcon.Pull)" :size="IconSize.Inline" />{{ state.behind }}
    </span>
    <span v-if="state.ahead > 0" class="count ahead">
      <Icon :icon="appIcon(AppIcon.Push)" :size="IconSize.Inline" />{{ state.ahead }}
    </span>
  </template>
  <span v-else-if="state?.kind === TrackingKind.Gone" class="gone">gone</span>
</template>

<style scoped>
.count {
  display: flex;
  align-items: center;
  gap: 1px;
}
.behind {
  color: var(--vscode-charts-blue);
}
.ahead {
  color: var(--vscode-charts-green);
}
.gone {
  color: var(--vscode-descriptionForeground);
}
</style>
