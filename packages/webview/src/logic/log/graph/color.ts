import { type GraphLayout, nameOf } from "./layout.js";

/**
 * 每行的颜色 id（非负整数）。编号是某个分支的主链时，取分支名的字符串 hash，同一个分支名在任何仓库、
 * 任何时候都是同一个颜色；头上没有 ref 的主链为 `undefined`（默认色）；分叉出来的片段取编号本身。
 * 有几种颜色由界面的调色板决定，这里只给身份。
 */
export function buildColors(layout: GraphLayout): (number | undefined)[] {
  return layout.indexes.map((index) => {
    if (!layout.mainRefs.has(index)) return index;
    const ref = layout.mainRefs.get(index);
    return ref === undefined ? undefined : hashOf(nameOf(ref));
  });
}

function hashOf(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0;
  return Math.abs(hash);
}
