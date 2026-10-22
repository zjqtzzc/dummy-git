/**
 * 三栏的宽度，与右栏里文件和详情的上下比例。
 *
 * 左栏、右栏固定像素宽度（默认 240 / 320），中间占剩下的全部：多出来的空间都给提交列表。
 * 右栏上面是文件、下面是详情，按比例分（默认文件占 70%），面板变高变矮时一起伸缩。
 * 拖动后的值记在 webview 的 `setState` 里，收起再展开、重新加载窗口后都恢复。
 */
export interface Layout {
  /** 左栏（分支）宽度。 */
  readonly left: number;
  /** 右栏（文件与详情）宽度。 */
  readonly right: number;
  /** 右栏里文件占的高度，百分比（0～100，不含两端），其余是详情。 */
  readonly files: number;
}

export const DEFAULT_LAYOUT: Layout = { left: 240, right: 320, files: 70 };

function isWidth(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isPercent(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value < 100;
}

/**
 * 从 `viewState` 里取回的值。格式不对（第一次打开是 `undefined`、
 * 以后改了存储格式）就用默认值，不抛。
 */
export function restoreLayout(saved: unknown): Layout {
  if (typeof saved !== "object" || saved === null) return DEFAULT_LAYOUT;
  const left: unknown = Reflect.get(saved, "left");
  const right: unknown = Reflect.get(saved, "right");
  const files: unknown = Reflect.get(saved, "files");
  const widths = isWidth(left) && isWidth(right) ? { left, right } : DEFAULT_LAYOUT;
  // 上下比例各自取回：没有它的旧记录，栏宽照样恢复。
  return {
    left: widths.left,
    right: widths.right,
    files: isPercent(files) ? files : DEFAULT_LAYOUT.files,
  };
}

/** `vsc-split-layout-change` 事件里分隔线的百分比位置（从左边或上边算起）；取不到就 `undefined`。 */
export function splitPercent(event: Event): number | undefined {
  if (!(event instanceof CustomEvent)) return undefined;
  const detail: unknown = event.detail;
  if (typeof detail !== "object" || detail === null) return undefined;
  const percent: unknown = Reflect.get(detail, "positionInPercentage");
  return isPercent(percent) ? percent : undefined;
}

/** `vsc-split-layout-change` 事件里分隔线的像素位置（从左边算起）；取不到就 `undefined`。 */
export function splitPosition(event: Event): number | undefined {
  if (!(event instanceof CustomEvent)) return undefined;
  const detail: unknown = event.detail;
  if (typeof detail !== "object" || detail === null) return undefined;
  const position: unknown = Reflect.get(detail, "position");
  return typeof position === "number" && Number.isFinite(position) ? position : undefined;
}
