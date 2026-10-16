/**
 * 固定行高的虚拟滚动：只渲染看得见的几十行。
 *
 * 一个高度为「总行数 × 行高」的占位元素撑出滚动条，滚动条从一开始就代表全部行；
 * 按「滚动位置 ÷ 行高」算出首个可见行。行高固定，一切都是乘除法。
 */

/** 与 VS Code 自己的列表行高一致。 */
export const ROW_HEIGHT = 22;

/** 可见范围上下各多渲染几行，快速滚动时不露白。 */
const OVERSCAN = 10;

/** `[start, end)` 行号区间。 */
export interface RowRange {
  readonly start: number;
  readonly end: number;
}

/** 要渲染哪几行：可见范围加上下余量，夹在 `[0, total)` 里。 */
export function renderRange(scrollTop: number, viewportHeight: number, total: number): RowRange {
  const first = Math.floor(scrollTop / ROW_HEIGHT);
  const count = Math.ceil(viewportHeight / ROW_HEIGHT) + 1;
  return {
    start: Math.max(0, first - OVERSCAN),
    end: Math.min(total, first + count + OVERSCAN),
  };
}

/**
 * 让第 `row` 行刚好露出来，只滚必要的距离：在上面就对齐顶部，在下面就对齐底部，
 * 看得见就不动。键盘逐行移动用它——一次一行，不跳半页。
 */
export function scrollIntoView(row: number, scrollTop: number, viewportHeight: number): number {
  const top = row * ROW_HEIGHT;
  if (top < scrollTop) return top;
  if (top + ROW_HEIGHT > scrollTop + viewportHeight) return top + ROW_HEIGHT - viewportHeight;
  return scrollTop;
}

/** 让第 `row` 行居中：看得见就不动。打开时跳到 HEAD 用它，四周的上下文都看得到。 */
export function scrollToCenter(row: number, scrollTop: number, viewportHeight: number): number {
  const top = row * ROW_HEIGHT;
  if (top >= scrollTop && top + ROW_HEIGHT <= scrollTop + viewportHeight) return scrollTop;
  return Math.max(0, top - (viewportHeight - ROW_HEIGHT) / 2);
}

/**
 * 列表刷新后（有新提交、切了分支），让选中的那一行停在屏幕上原来的位置：
 * 上方多了几行，就往下多滚几行，视图不跳。
 */
export function keepRowInPlace(oldRow: number, newRow: number, scrollTop: number): number {
  return Math.max(0, scrollTop + (newRow - oldRow) * ROW_HEIGHT);
}
