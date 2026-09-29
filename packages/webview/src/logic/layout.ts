/**
 * 三栏的宽度：外层分隔线（左 | 中+右）与内层分隔线（中 | 右）的位置，单位是百分比。
 *
 * 需求第 1 阶段：初始 左 20% / 中 55% / 右 25%；拖动后的宽度记在 webview 的
 * `setState` 里，面板收起再展开、重新加载窗口后都恢复。
 */
export interface Layout {
  /** 外层：左栏占整体的百分比。 */
  readonly outer: number;
  /** 内层：中栏占「中 + 右」的百分比。 */
  readonly inner: number;
}

/** 内层 = 55 / (55 + 25)。 */
export const DEFAULT_LAYOUT: Layout = { outer: 20, inner: (55 / 80) * 100 };

function isPercent(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value < 100;
}

/**
 * 从 `getState()` 里取回的值。它来自上一次的 `setState`，但类型在运行时已擦除——
 * 格式不对（第一次打开是 `undefined`、以后改了存储格式）就用默认值，不抛。
 */
export function restoreLayout(saved: unknown): Layout {
  if (typeof saved !== "object" || saved === null) return DEFAULT_LAYOUT;
  const outer: unknown = Reflect.get(saved, "outer");
  const inner: unknown = Reflect.get(saved, "inner");
  return isPercent(outer) && isPercent(inner) ? { outer, inner } : DEFAULT_LAYOUT;
}

/** `vsc-split-layout-change` 事件里的百分比；取不到就 `undefined`。 */
export function splitPercent(event: Event): number | undefined {
  if (!(event instanceof CustomEvent)) return undefined;
  const detail: unknown = event.detail;
  if (typeof detail !== "object" || detail === null) return undefined;
  const percent: unknown = Reflect.get(detail, "positionInPercentage");
  return isPercent(percent) ? percent : undefined;
}
