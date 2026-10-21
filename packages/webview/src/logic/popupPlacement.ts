import { assertNever } from "@dummy-git/shared";

/**
 * 浮层选单放在哪：上下左右都不超出 webview。
 *
 * 通行的四步（Floating UI 的 placement、flip、shift、size）：
 * 1. 首选位置：一级选单在按钮正下方、左边对齐；二级选单在父项右边、顶部对齐。
 * 2. 翻面：首选那边放不下、对面放得下，翻到对面。
 * 3. 挪动：另一个方向上超出了，往回挪到刚好不超出。
 * 4. 限高：上下都放不下时压低高度，选单里滚动。
 * 坐标都是相对 webview 左上角的像素（`getBoundingClientRect` 的口径）。
 */

/** 贴着的元素（按钮、父项）占的矩形。 */
export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** 首选往哪边弹。 */
export enum PopupSide {
  /** 一级选单：按钮下方。 */
  Below = "below",
  /** 二级选单：父项右边。 */
  Right = "right",
}

/** 浮层的左上角，以及要压低时的高度上限（放得下时缺席）。 */
export interface Placement {
  readonly left: number;
  readonly top: number;
  readonly maxHeight?: number;
}

/** 一级选单和按钮之间的空隙。二级选单紧贴父项，不留。 */
const BELOW_GAP = 2;

/** 一个方向上的结果：起点，以及放不下时的长度上限。 */
interface Span {
  readonly start: number;
  readonly max?: number;
}

/**
 * 主方向（弹出的方向）：首选贴在 `end` 之后，放不下就翻到 `start` 之前；
 * 两边都放不下时放在空间大的那边，`limit` 为真就限长，否则挪进可见范围（宁可盖住贴着的元素）。
 */
function mainAxis(
  start: number,
  end: number,
  length: number,
  viewport: number,
  gap: number,
  limit: boolean,
): Span {
  const after = viewport - (end + gap);
  const before = start - gap;
  if (length <= after) return { start: end + gap };
  if (length <= before) return { start: start - gap - length };
  if (!limit) return { start: Math.max(0, viewport - length) };
  return after >= before ? { start: end + gap, max: after } : { start: 0, max: before };
}

/** 另一个方向：从 `start` 起，超出就往回挪；比整个可见范围还长时 `limit` 为真就限长。 */
function crossAxis(start: number, length: number, viewport: number, limit: boolean): Span {
  if (length > viewport) return limit ? { start: 0, max: viewport } : { start: 0 };
  return { start: Math.max(0, Math.min(start, viewport - length)) };
}

/** 浮层放在哪。只压低高度，不压窄宽度：选单项的文字被截断比挪过去盖住一点更难用。 */
export function placePopup(anchor: Rect, side: PopupSide, popup: Size, viewport: Size): Placement {
  switch (side) {
    case PopupSide.Below: {
      const y = mainAxis(
        anchor.top,
        anchor.top + anchor.height,
        popup.height,
        viewport.height,
        BELOW_GAP,
        true,
      );
      const x = crossAxis(anchor.left, popup.width, viewport.width, false);
      return { left: x.start, top: y.start, ...(y.max === undefined ? {} : { maxHeight: y.max }) };
    }
    case PopupSide.Right: {
      const x = mainAxis(
        anchor.left,
        anchor.left + anchor.width,
        popup.width,
        viewport.width,
        0,
        false,
      );
      const y = crossAxis(anchor.top, popup.height, viewport.height, true);
      return { left: x.start, top: y.start, ...(y.max === undefined ? {} : { maxHeight: y.max }) };
    }
    default:
      return assertNever(side, "placePopup");
  }
}
