/**
 * 图标：「是什么」与「多大」分开，任意组合，统一由 `Icon.vue` 画。
 *
 * - 是什么：`IconRef`。来源有三种——我们自己画的 SVG（`AppIcon`）、codicon 字体、Seti 文件图标字体。
 *   画法各不相同（SVG 用宽高，字体用字号，Seti 还要放大），对外一样。
 *   纯数据、不依赖 Vue，所以放在 `logic/`：构造树节点的纯逻辑也要用它。
 * - 多大：`IconSize`，按用途命名，「用途 → 像素」的表在 `Icon.vue`。新用途加一档。
 */

export enum IconSize {
  /** 按钮、行首图标。 */
  Standard = "standard",
  /** 嵌在文字里、和数字或文字排在一行。 */
  Inline = "inline",
}

export enum IconKind {
  App = "app",
  Codicon = "codicon",
  Seti = "seti",
}

export type IconRef =
  | { readonly kind: IconKind.App; readonly name: AppIcon }
  | { readonly kind: IconKind.Codicon; readonly name: string }
  /** Seti 文件图标：字形与它自带的颜色由 `setiIcon(文件名, 浅色主题?)` 查出。 */
  | { readonly kind: IconKind.Seti; readonly char: string; readonly color: string };

export function appIcon(name: AppIcon): IconRef {
  return { kind: IconKind.App, name };
}

/** codicon 的名字，比如 `discard`、`folder-opened`。 */
export function codicon(name: string): IconRef {
  return { kind: IconKind.Codicon, name };
}

/**
 * 我们自己画的图标（codicon 里没有的）。全部集中在这一张表里，加图标就加一行。
 *
 * 每个图标是 16×16 坐标系里的几条线，线宽 1、颜色 `currentColor`（跟着主题的图标色或外面给的颜色）。
 * 形状照 IDEA：↙ 是「从远程进来」，↗ 是「推到远程去」。
 */
export enum AppIcon {
  /** 整个虚线的 ↙：取回远程的记录，不动本地分支。 */
  Fetch = "fetch",
  /** 实线 ↙：把远程的提交拉进本地分支。 */
  Pull = "pull",
  /** 实线 ↗：把本地分支推到远程。 */
  Push = "push",
  /** 箭头向下落进托盘：把改动存进 stash。 */
  Stash = "stash",
  /** 箭头从托盘里向上出来：把 stash 取回工作区。 */
  Unstash = "unstash",
  /** 上下两个向外的尖角：全部展开。 */
  ExpandAll = "expandAll",
  /** 上下两个向里的尖角：全部收起。 */
  CollapseAll = "collapseAll",
  /** 放大镜：搜索。 */
  Search = "search",
  /** ×：清除、关闭。 */
  Close = "close",
  /** ▾：下拉。 */
  Dropdown = "dropdown",
  /** 眼睛：View Options，开关显示选项。 */
  ViewOptions = "viewOptions",
  /** 左边向下的箭头、右边一条线串着两个提交：Graph Options（照 IDEA 新界面的 `intelliSort.svg`）。 */
  GraphOptions = "graphOptions",
}

/** 托盘：方框，顶边中间凹下去一块，Stash / Unstash 的箭头从这里进出。 */
const TRAY = "M1.5 8.5H4.2L5.2 10.5H10.8L11.8 8.5H14.5V13.5H1.5Z";

/**
 * 每个图标是几条线，每条是 SVG path 的 `d`。
 *
 * Fetch、Pull、Push 的箭头头部一样大（直角两边各 7）。Fetch 的虚线逐段排（照 IDEA）：
 * 拐角是实的，线头是整段。不用 `stroke-dasharray`——它从哪里断由线长决定，拐角可能落在空白里。
 */
export const ICON_STROKES: Readonly<Record<AppIcon, readonly string[]>> = {
  [AppIcon.Fetch]: [
    "M12.5 3.5L11.1 4.9",
    "M9.7 6.3L8.3 7.7",
    "M6.8 9.2L5.4 10.6",
    "M3.5 5.5V7.5",
    "M3.5 9.5V12.5H6.5",
    "M8.5 12.5H10.5",
  ],
  [AppIcon.Pull]: ["M12.5 3.5L3.5 12.5", "M3.5 5.5V12.5H10.5"],
  [AppIcon.Push]: ["M3.5 12.5L12.5 3.5", "M5.5 3.5H12.5V10.5"],
  [AppIcon.Stash]: ["M8 1.5V8.5", "M5 5.5L8 8.5L11 5.5", TRAY],
  [AppIcon.Unstash]: ["M8 8.5V1.5", "M5 4.5L8 1.5L11 4.5", TRAY],
  [AppIcon.ExpandAll]: ["M4.5 5.5L8 2L11.5 5.5", "M4.5 10.5L8 14L11.5 10.5"],
  [AppIcon.CollapseAll]: ["M4.5 2.5L8 6L11.5 2.5", "M4.5 13.5L8 10L11.5 13.5"],
  [AppIcon.Search]: ["M11.5 7A4.5 4.5 0 1 1 2.5 7A4.5 4.5 0 1 1 11.5 7Z", "M10.2 10.2L13.5 13.5"],
  [AppIcon.Close]: ["M4.5 11.5L11.5 4.5", "M11.5 11.5L4.5 4.5"],
  [AppIcon.Dropdown]: ["M4 6L8 10L12 6"],
  // 眼眶上下两道弧，中间一个圆的瞳孔。
  [AppIcon.ViewOptions]: [
    "M8 4C4.5 4 2 8 2 8C2 8 4.5 12 8 12C11.5 12 14 8 14 8C14 8 11.5 4 8 4Z",
    "M10 8A2 2 0 1 1 6 8A2 2 0 1 1 10 8Z",
  ],
  [AppIcon.GraphOptions]: [
    "M4.5 2.5V13.5",
    "M1.5 10.5L4.5 13.5L7.5 10.5",
    "M11.5 2.5V4",
    "M13 5.5A1.5 1.5 0 1 1 10 5.5A1.5 1.5 0 1 1 13 5.5Z",
    "M11.5 7V9",
    "M13 10.5A1.5 1.5 0 1 1 10 10.5A1.5 1.5 0 1 1 13 10.5Z",
    "M11.5 12V13.5",
  ],
};
