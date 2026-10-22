/**
 * 列表与树共用的多选规则。
 *
 * 只认 id 和行的显示顺序（`order`，看得见的行从上到下），不认识提交、分支还是文件。
 * 每种点击、按键都是一个纯函数：旧的选中加这次的动作，得出新的选中。
 */
export interface Selection {
  /** 选中的 id。只存 id，不随行数生成别的东西。 */
  readonly ids: ReadonlySet<string>;
  /** Shift 选一段时的起点：最近一次单击或 Ctrl+单击的那一行。 */
  readonly anchor?: string;
  /** 光标所在的行：最近点过或挪到的那一行。↑↓ 从它出发。 */
  readonly cursor?: string;
}

export const EMPTY_SELECTION: Selection = { ids: new Set() };

/** 单击、↑↓：只选这一行。 */
export function selectOnly(id: string): Selection {
  return { ids: new Set([id]), anchor: id, cursor: id };
}

/** Ctrl+单击（Mac 上 Cmd+单击）：这一行加进选中或移出选中，其余不动。 */
export function toggle(selection: Selection, id: string): Selection {
  const ids = new Set(selection.ids);
  if (ids.has(id)) ids.delete(id);
  else ids.add(id);
  return { ids, anchor: id, cursor: id };
}

/**
 * Shift+单击、Shift+↑↓：从锚点到 `id` 整段选中，锚点不动。
 * `add` 为 `true`（Ctrl+Shift+单击）时这一段加进原来的选中，否则替换掉原来的。
 * 没有锚点、或锚点已不在列表里（被过滤掉了）时，当作单击。
 */
export function extendTo(
  selection: Selection,
  order: readonly string[],
  id: string,
  add: boolean,
): Selection {
  const { anchor } = selection;
  const from = anchor === undefined ? -1 : order.indexOf(anchor);
  const to = order.indexOf(id);
  if (anchor === undefined || from === -1 || to === -1) return selectOnly(id);
  const range = order.slice(Math.min(from, to), Math.max(from, to) + 1);
  const ids = add ? new Set([...selection.ids, ...range]) : new Set(range);
  return { ids, anchor, cursor: id };
}

/** Ctrl+A（Mac 上 Cmd+A）：全选看得见的行。锚点和光标不动。 */
export function selectAll(selection: Selection, order: readonly string[]): Selection {
  return { ...selection, ids: new Set(order) };
}

/**
 * 右键：点在已选中的行上，选中不变，菜单作用于全部；点在没选中的行上，先改成只选这一行。
 */
export function contextMenuOn(selection: Selection, id: string): Selection {
  return selection.ids.has(id) ? selection : selectOnly(id);
}

/**
 * 刷新、过滤之后：还在列表里的留着，不在的去掉；锚点、光标不在了就去掉。
 * 一个都不剩时怎么办（选 HEAD 还是什么都不选）由使用方决定。
 */
export function retain(selection: Selection, order: readonly string[]): Selection {
  const present = new Set(order);
  const ids = new Set([...selection.ids].filter((id) => present.has(id)));
  return {
    ids,
    ...(selection.anchor !== undefined && present.has(selection.anchor)
      ? { anchor: selection.anchor }
      : {}),
    ...(selection.cursor !== undefined && present.has(selection.cursor)
      ? { cursor: selection.cursor }
      : {}),
  };
}

/** 恰好选中一行时是它，否则缺席。右栏只在这时取文件。 */
export function singleOf(selection: Selection): string | undefined {
  if (selection.ids.size !== 1) return undefined;
  const [id] = selection.ids;
  return id;
}

/** 点一行时按着的键：`toggle` 是 Ctrl（Mac 上 Cmd），`range` 是 Shift。 */
export interface ClickModifiers {
  readonly toggle: boolean;
  readonly range: boolean;
}

/** 点一行：按修饰键分给单击、Ctrl+单击、Shift+单击、Ctrl+Shift+单击。 */
export function clickRow(
  selection: Selection,
  order: readonly string[],
  id: string,
  modifiers: ClickModifiers,
): Selection {
  if (modifiers.range) return extendTo(selection, order, id, modifiers.toggle);
  return modifiers.toggle ? toggle(selection, id) : selectOnly(id);
}

/**
 * ↑↓（`delta` 为 -1 / 1）：从光标挪一行，到头就停。`extend`（Shift）时从锚点选到新的那行，否则只选新的那行。
 * 没有光标时从第一行开始。
 */
export function stepCursor(
  selection: Selection,
  order: readonly string[],
  delta: number,
  extend: boolean,
): Selection {
  const current = selection.cursor === undefined ? -1 : order.indexOf(selection.cursor);
  const next = order[Math.min(order.length - 1, Math.max(0, current + delta))];
  if (next === undefined) return selection;
  return extend ? extendTo(selection, order, next, false) : selectOnly(next);
}
