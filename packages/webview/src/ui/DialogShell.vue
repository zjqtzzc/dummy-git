<script setup lang="ts">
/**
 * 对话框的通用外壳：标题与一行说明、中间内容、贴底的按钮栏。
 *
 * 一列，最宽 680px，水平居中，从顶上排。内容超出时只有中间滚动，标题与按钮栏不动。
 * 各对话框只往插槽里填：默认插槽是内容，`buttons` 是按钮，主按钮放最后（排在最右）；
 * `status` 可选，画在底栏左侧（Rollback 写勾了几个文件）。
 */
defineProps<{ title: string; description: string }>();
const slots = defineSlots<{ default?(): unknown; buttons?(): unknown; status?(): unknown }>();
</script>

<template>
  <div class="dialog">
    <header class="head">
      <h1>{{ title }}</h1>
      <p class="dim">{{ description }}</p>
    </header>
    <main class="body"><slot /></main>
    <footer class="buttons">
      <span v-if="slots.status" class="status dim"><slot name="status" /></span>
      <slot name="buttons" />
    </footer>
  </div>
</template>

<style scoped>
.dialog {
  box-sizing: border-box;
  height: 100vh;
  max-width: 680px;
  margin: 0 auto;
  padding: 0 16px;
  display: flex;
  flex-direction: column;
}
.head {
  padding: 20px 0 8px;
}
h1 {
  margin: 0;
  font-size: 1.6em;
  font-weight: 600;
}
.head p {
  margin: 6px 0 0;
}
.body {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.buttons {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  padding: 12px 0 16px;
}
.status {
  margin-right: auto;
}
</style>
