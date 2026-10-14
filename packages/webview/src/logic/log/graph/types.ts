/** 提交图布局的输入与输出。只有声明，没有数据表。 */

/** 一条父子连线：子提交在 `up` 行，父提交在 `down` 行，`up < down`。 */
export interface GraphEdge {
  readonly up: number;
  readonly down: number;
}

/** 一段线从本行往哪个相邻行画。 */
export enum Direction {
  Up = "up",
  Down = "down",
}

/** 本行里的一段线：从本行第 `from` 个位置的中心，画到相邻行第 `to` 个位置的中心，超出本行的部分裁掉。 */
export interface GraphSegment {
  readonly from: number;
  readonly to: number;
  readonly direction: Direction;
  /** 颜色 id：取两端里编号较大的那个节点的颜色。`undefined` 为默认色。 */
  readonly color: number | undefined;
}

export interface GraphRow {
  /** 本行节点的位置。 */
  readonly nodePosition: number;
  /** 本行节点的颜色 id。`undefined` 为默认色。 */
  readonly nodeColor: number | undefined;
  readonly segments: readonly GraphSegment[];
  /** 本行的图要几条车道宽。斜线在本行只画一半，按半格算，所以可以是 .5。 */
  readonly width: number;
}

export interface Graph {
  /** 与列表的行一一对应。 */
  readonly rows: readonly GraphRow[];
  /** 公共基准宽度（车道数）：比它窄的行文字对齐到它，比它宽的行文字单独往右退。 */
  readonly base: number;
}
