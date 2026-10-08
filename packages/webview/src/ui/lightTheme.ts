import { onMounted, onUnmounted, type Ref, ref } from "vue";

/**
 * 当前是不是浅色主题（Seti 文件图标浅色主题用 `_light` 那一套）。
 * VS Code 切主题时改 body 的类名，跟着它走。在组件的 setup 里调用。
 */
export function useLightTheme(): Readonly<Ref<boolean>> {
  const light = ref(false);
  const read = (): void => {
    const classes = document.body.classList;
    light.value =
      classes.contains("vscode-light") || classes.contains("vscode-high-contrast-light");
  };
  const watcher = new MutationObserver(read);
  onMounted(() => {
    read();
    watcher.observe(document.body, { attributes: true, attributeFilter: ["class"] });
  });
  onUnmounted(() => watcher.disconnect());
  return light;
}
