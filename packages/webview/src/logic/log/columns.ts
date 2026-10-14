import { assertNever } from "@dummy-git/shared";

/**
 * 提交列表 Author、Date 两列的宽度，像素。Message 占剩下的全部。
 * 拖过才有；没拖过时由 CSS 给 em 默认值，跟着字号走。
 */
export interface Columns {
  readonly author: number;
  readonly date: number;
}

/** 拖的是哪条分界线。 */
export enum ColumnHandle {
  /** Message | Author：只改 Author。 */
  Author = "author",
  /** Author | Date：两列此消彼长，Message 不动。 */
  Date = "date",
}

/** 拖窄到这里为止，分界线还抓得住。 */
const MIN_WIDTH = 40;

/** 从拖动开始时的宽度 `start` 起，分界线往右移了 `dx` 像素（往左为负）。 */
export function resizeColumns(start: Columns, handle: ColumnHandle, dx: number): Columns {
  switch (handle) {
    case ColumnHandle.Author:
      return { ...start, author: Math.max(MIN_WIDTH, start.author - dx) };
    case ColumnHandle.Date: {
      const total = start.author + start.date;
      const author = Math.min(Math.max(MIN_WIDTH, start.author + dx), total - MIN_WIDTH);
      return { author, date: total - author };
    }
    default:
      return assertNever(handle, "resizeColumns");
  }
}

/** 从 `viewState` 取回的值；格式不对（没拖过、改了存储格式）就是 `undefined`，用 CSS 默认值。 */
export function restoreColumns(saved: unknown): Columns | undefined {
  if (typeof saved !== "object" || saved === null) return undefined;
  const author: unknown = Reflect.get(saved, "author");
  const date: unknown = Reflect.get(saved, "date");
  return isWidth(author) && isWidth(date) ? { author, date } : undefined;
}

function isWidth(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
