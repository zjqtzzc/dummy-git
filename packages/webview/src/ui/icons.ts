/**
 * 图标：「是什么」与「多大」分开，任意组合，统一由 `Icon.vue` 画。
 *
 * - 是什么：`IconRef`。来源有两种——我们自己画的 SVG（`AppIcon`）与 codicon 字体。
 *   两种的画法不同（SVG 用宽高，字体用字号），对外一样。
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
}

export type IconRef =
  | { readonly kind: IconKind.App; readonly name: AppIcon }
  | { readonly kind: IconKind.Codicon; readonly name: string };

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
}

/** 一条线：SVG path 的 `d`；`dashed` 为虚线。 */
export interface IconStroke {
  readonly d: string;
  readonly dashed?: boolean;
}

/** ↙ 的箭头部分：直角折线，尖在左下。 */
const INCOMING_HEAD = "M3.5 6.5V12.5H9.5";

export const ICON_STROKES: Readonly<Record<AppIcon, readonly IconStroke[]>> = {
  [AppIcon.Fetch]: [
    { d: "M12.5 3.5L3.5 12.5", dashed: true },
    { d: INCOMING_HEAD, dashed: true },
  ],
  [AppIcon.Pull]: [{ d: "M12.5 3.5L3.5 12.5" }, { d: INCOMING_HEAD }],
  [AppIcon.Push]: [{ d: "M3.5 12.5L12.5 3.5" }, { d: "M6.5 3.5H12.5V9.5" }],
};
