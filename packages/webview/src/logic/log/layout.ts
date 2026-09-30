/**
 * 三栏宽度，单位一律是像素。
 *
 * 需求第 1 阶段：左栏、右栏固定像素宽度（默认 240 / 320），中间占剩下的全部；拖动后的宽度
 * 记在 webview 的 `setState` 里，收起再展开、重新加载窗口后都恢复；窗口大小变化时左右不变。
 */
export interface Layout {
  /** 左栏（分支）宽度。 */
  readonly left: number;
  /** 右栏（文件）宽度。 */
  readonly right: number;
}

export const DEFAULT_LAYOUT: Layout = { left: 240, right: 320 };

function isWidth(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * 从 `viewState` 里取回的值。类型在运行时已擦除——格式不对（第一次打开是 `undefined`、
 * 以后改了存储格式）就用默认值，不抛。
 */
export function restoreLayout(saved: unknown): Layout {
  if (typeof saved !== "object" || saved === null) return DEFAULT_LAYOUT;
  const left: unknown = Reflect.get(saved, "left");
  const right: unknown = Reflect.get(saved, "right");
  return isWidth(left) && isWidth(right) ? { left, right } : DEFAULT_LAYOUT;
}

/** `vsc-split-layout-change` 事件里分隔线的像素位置（从左边算起）；取不到就 `undefined`。 */
export function splitPosition(event: Event): number | undefined {
  if (!(event instanceof CustomEvent)) return undefined;
  const detail: unknown = event.detail;
  if (typeof detail !== "object" || detail === null) return undefined;
  const position: unknown = Reflect.get(detail, "position");
  return typeof position === "number" && Number.isFinite(position) ? position : undefined;
}
