/**
 * 右键菜单项的定义与计算：每个菜单项一个键，键在就出现，值是它要作用的对象。
 *
 * 一个菜单项写三样：单个判断（这一个能不能做）、整体条件（可选，比如「正好一个」）、值（交给扩展的参数）。
 * 规则全部严格：每一个都能做、整体条件也满足才出现，点了就全做，不跳过任何东西。
 * 「出不出现」和「作用于谁」由同一份定义算出，扩展的菜单命令只读自己那个键，不再判断一遍。
 */

/** 菜单上下文里一个键的值：一个对象或一串对象。 */
export type MenuValue = string | readonly string[];

/** 选中的东西，至少一个。 */
export type NonEmpty<T> = readonly [T, ...T[]];

export interface MenuItem<T> {
  /** 上下文里的键，和 `package.json` 里这一项的 `when` 对应（`shared/src/menu.ts`）。 */
  readonly key: string;
  /** 这一个能不能做。缺席即都能做。 */
  readonly accepts?: (item: T) => boolean;
  /** 对整体的要求。缺席即没有要求。 */
  readonly whole?: (items: NonEmpty<T>) => boolean;
  readonly value: (items: NonEmpty<T>) => MenuValue;
}

/** 整体条件：正好一个。只能对一个做的菜单项用它。 */
export function exactlyOne<T>(items: NonEmpty<T>): boolean {
  return items.length === 1;
}

/** 按选中（显示顺序）算出每个菜单项的键与值。什么都没选时一项都没有。 */
export function menuItemsContext<T>(
  items: readonly T[],
  definitions: readonly MenuItem<T>[],
): Record<string, MenuValue> {
  const [first, ...rest] = items;
  if (first === undefined) return {};
  const all: NonEmpty<T> = [first, ...rest];
  const context: Record<string, MenuValue> = {};
  for (const item of definitions) {
    if (item.accepts !== undefined && !all.every(item.accepts)) continue;
    if (item.whole !== undefined && !item.whole(all)) continue;
    context[item.key] = item.value(all);
  }
  return context;
}
