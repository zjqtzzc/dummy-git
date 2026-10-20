/**
 * 右键菜单项的定义与计算：每个菜单项一个键（就是它的命令 id），键在就出现，值是这条命令的协议参数（不含 `repo`）。
 *
 * 一个菜单项写三样：单个判断（从这一个里取出要用的东西，取不出就是不能做）、整体条件（可选，比如「正好一个」）、值。
 * 规则全部严格：每一个都能做、整体条件也满足才出现，点了就全做，不跳过任何东西。
 * 「出不出现」和「作用于谁」由同一份定义算出，扩展的菜单命令只读自己那个键，不再判断一遍。
 */

/** 菜单上下文里一个键的值：这条命令的协议参数，不含 `repo`。扩展原样取出、补上 `repo` 再校验。 */
export type MenuArgs = Readonly<Record<string, string | readonly string[]>>;

/** 选中的东西，至少一个。 */
export type NonEmpty<T> = readonly [T, ...T[]];

/** 一个菜单项。由 `menuItem` 造出来，`T` 是选中的东西。 */
export interface MenuItem<T> {
  /** 上下文里的键，也是这一项的命令 id（`shared/src/menu.ts`）。 */
  readonly key: string;
  /** 不能做时缺席。 */
  readonly evaluate: (items: NonEmpty<T>) => MenuArgs | undefined;
}

/**
 * 定义一个菜单项。`pick` 从一个选中的东西里取出这一项要用的（`U`），取不出就是这一个不能做；
 * `whole` 看取出来的全部；`value` 把它们变成协议参数。
 */
export function menuItem<T, U>(definition: {
  readonly key: string;
  readonly pick: (item: T) => U | undefined;
  readonly whole?: (picked: NonEmpty<U>) => boolean;
  readonly value: (picked: NonEmpty<U>) => MenuArgs;
}): MenuItem<T> {
  return {
    key: definition.key,
    evaluate: ([first, ...rest]) => {
      const head = definition.pick(first);
      if (head === undefined) return undefined;
      const picked: [U, ...U[]] = [head];
      for (const item of rest) {
        const one = definition.pick(item);
        if (one === undefined) return undefined;
        picked.push(one);
      }
      if (definition.whole !== undefined && !definition.whole(picked)) return undefined;
      return definition.value(picked);
    },
  };
}

/** 整体条件：正好一个。只能对一个做的菜单项用它。 */
export function exactlyOne<T>(items: NonEmpty<T>): boolean {
  return items.length === 1;
}

/** 按选中（显示顺序）算出每个菜单项的键与值。什么都没选时一项都没有。 */
export function menuItemsContext<T>(
  items: readonly T[],
  definitions: readonly MenuItem<T>[],
): Record<string, MenuArgs> {
  const [first, ...rest] = items;
  if (first === undefined) return {};
  const context: Record<string, MenuArgs> = {};
  for (const item of definitions) {
    const args = item.evaluate([first, ...rest]);
    if (args !== undefined) context[item.key] = args;
  }
  return context;
}
