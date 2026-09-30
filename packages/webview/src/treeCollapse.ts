/**
 * 所有树共用：收起一个目录时，它下面的子目录一起收起，再展开只露出一层
 * （`.notes/REQUIREMENTS.md` 第 2 阶段）。
 *
 * 树组件展开 / 收起不发事件，但会把 `open` 同步到 HTML 属性上，所以监听这个属性。
 * 去掉子项的 `open` 属性，组件会跟着把自己的状态改成收起；这些改动又会触发这里，
 * 但那时下面已经没有展开的项，什么都不做。
 */
export function collapseDescendants(tree: Element): MutationObserver {
  const observer = new MutationObserver((mutations) => {
    for (const { target } of mutations) {
      if (!(target instanceof Element) || target.hasAttribute("open")) continue;
      for (const item of target.querySelectorAll("vscode-tree-item[open]")) {
        item.removeAttribute("open");
      }
    }
  });
  observer.observe(tree, { subtree: true, attributes: true, attributeFilter: ["open"] });
  return observer;
}
