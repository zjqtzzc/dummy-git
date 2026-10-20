/**
 * 右键菜单项的定义与计算：每个菜单项一个键（就是它的命令 id），键在就出现，值是这条命令的协议参数（不含 `repo`）。
 *
 * 一个菜单项写四样：看法（原样看还是展开看）、单个判断（从这一个里取出要用的东西，取不出就是不能做）、
 * 整体条件（可选，比如「正好一个」）、值。
 * 规则全部严格：每一个都能做、整体条件也满足才出现，点了就全做，不跳过任何东西。
 * 「出不出现」和「作用于谁」由同一份定义算出，扩展的菜单命令只读自己那个键，不再判断一遍。
 */

/** 菜单上下文里一个键的值：这条命令的协议参数，不含 `repo`。扩展原样取出、补上 `repo` 再校验。 */
export type MenuArgs = Readonly<
  Record<string, string | readonly string[] | readonly Readonly<Record<string, string>>[]>
>;

/** 选中的东西，至少一个。 */
export type NonEmpty<T> = readonly [T, ...T[]];

/**
 * 菜单项看选中的哪一种：
 * - 原样看：点中的那几个本身，目录就是目录（只能对一个做的项、目录本身就是对象的项）。
 * - 展开看：点中的叶子，加上点中目录下面列出的全部叶子，去掉重复（目录只是归类时，批量的项）。
 * 没有目录的列表（提交列表）两种一样。
 */
export enum MenuView {
  Exact = "exact",
  Expanded = "expanded",
}

/** 选中的两种看法，按显示顺序。 */
export interface MenuViews<T> {
  readonly exact: readonly T[];
  readonly expanded: readonly T[];
}

/**
 * 一个菜单项。由 `menuItem` 造出来，`T` 是选中的东西，`V` 是它给出的协议参数。
 * 竖按钮、工具栏按钮也直接用它（`evaluate`），和右键菜单同一份规则。
 */
export interface MenuItem<T, V extends MenuArgs = MenuArgs> {
  /** 上下文里的键，也是这一项的命令 id（`shared/src/menu.ts`）。 */
  readonly key: string;
  /** 按选中算这一项：不能做时缺席。 */
  readonly evaluate: (views: MenuViews<T>) => V | undefined;
}

/**
 * 定义一个菜单项。按 `view` 取出选中；`pick` 从一个选中的东西里取出这一项要用的（`U`），取不出就是这一个不能做；
 * `whole` 看取出来的全部（需要时也能看点中的节点本身，`views.exact`）；`value` 把它们变成协议参数。
 * 那种看法下什么都没有时，这一项不出现。
 */
export function menuItem<T, U, V extends MenuArgs>(definition: {
  readonly key: string;
  readonly view: MenuView;
  readonly pick: (item: T) => U | undefined;
  readonly whole?: (picked: NonEmpty<U>, views: MenuViews<T>) => boolean;
  readonly value: (picked: NonEmpty<U>) => V;
}): MenuItem<T, V> {
  return {
    key: definition.key,
    evaluate: (views) => {
      const items = definition.view === MenuView.Exact ? views.exact : views.expanded;
      const [first, ...rest] = items;
      if (items.length === 0 || first === undefined) return undefined;
      const head = definition.pick(first);
      if (head === undefined) return undefined;
      const picked: [U, ...U[]] = [head];
      for (const item of rest) {
        const one = definition.pick(item);
        if (one === undefined) return undefined;
        picked.push(one);
      }
      if (definition.whole !== undefined && !definition.whole(picked, views)) return undefined;
      return definition.value(picked);
    },
  };
}

/** 整体条件：正好一个。只能对一个做的菜单项用它。 */
export function exactlyOne<T>(items: NonEmpty<T>): boolean {
  return items.length === 1;
}

/** 按选中算出每个菜单项的键与值，每一项用它自己的看法。 */
export function menuItemsContext<T>(
  views: MenuViews<T>,
  definitions: readonly MenuItem<T>[],
): Record<string, MenuArgs> {
  const context: Record<string, MenuArgs> = {};
  for (const item of definitions) {
    const args = item.evaluate(views);
    if (args !== undefined) context[item.key] = args;
  }
  return context;
}

/** 没有目录的列表：两种看法一样。 */
export function flatViews<T>(items: readonly T[]): MenuViews<T> {
  return { exact: items, expanded: items };
}
