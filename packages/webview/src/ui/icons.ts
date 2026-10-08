/**
 * 我们自己画的图标（codicon 里没有的）。全部集中在这一张表里，加图标就加一行。
 *
 * 每个图标是 16×16 坐标系里的几条线，线宽 1、颜色 `currentColor`（跟着主题的图标色或外面给的颜色）。
 * 形状照 IDEA：↙ 是「从远程进来」，↗ 是「推到远程去」。
 */
export enum AppIcon {
  /** 虚线 ↙：取回远程的记录，不动本地分支。 */
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
  [AppIcon.Fetch]: [{ d: "M12.5 3.5L3.5 12.5", dashed: true }, { d: INCOMING_HEAD }],
  [AppIcon.Pull]: [{ d: "M12.5 3.5L3.5 12.5" }, { d: INCOMING_HEAD }],
  [AppIcon.Push]: [{ d: "M3.5 12.5L12.5 3.5" }, { d: "M6.5 3.5H12.5V9.5" }],
};
