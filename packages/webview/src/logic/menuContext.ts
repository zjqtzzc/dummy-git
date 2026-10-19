/**
 * 原生右键菜单的上下文写在哪：列表或树的容器上，右键那一刻才写，行上不带。
 *
 * VS Code 弹菜单时读被点元素及其外层的 `data-vscode-context`，它的监听在最外层；
 * 右键事件从被点的行往外传，先到容器，所以容器在这一刻写下的值 VS Code 能读到（F5 调试窗口实测）。
 * 不让每行各带一份：VS Code 只看被点的那一行，写在容器上，上下文才能由右键时的整个选中算出来。
 * 写的时候直接改 DOM，不经 Vue：Vue 稍后才把改动写进 DOM，赶不赶得上 VS Code 读，取决于浏览器内部的时机。
 */

/**
 * 容器上要写的 JSON。`row` 是被点那一行的上下文；点在空白处、或那一行没有菜单时缺席。
 * 总是带上 `preventDefaultContextMenuItems`：否则 VS Code 会在菜单里加上剪切、复制、粘贴这些浏览器默认项。
 */
export function containerMenuContext(
  row: Readonly<Record<string, string | boolean | readonly string[]>> | undefined,
): string {
  return JSON.stringify({ ...row, preventDefaultContextMenuItems: true });
}
