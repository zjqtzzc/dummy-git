import { MenuContextKey } from "@dummy-git/shared";
import {
  exactlyOne,
  flatViews,
  type MenuArgs,
  type MenuItem,
  MenuView,
  menuItem,
  menuItemsContext,
  type NonEmpty,
} from "../menuItems.js";

/** 提交列表的一行，菜单项要用的那几样。 */
export interface CommitMenuTarget {
  readonly hash: string;
  /** 能改说明（`rewordable`）。 */
  readonly rewordable: boolean;
  /** 合并提交（不止一个父提交）。 */
  readonly merge: boolean;
}

/**
 * Cherry-Pick、Revert 的整体条件：一条时照旧交给 git（合并提交 git 自己拒绝，什么都不动）；
 * 多条时不能有合并提交——git 在一串里碰到它会报错退出，前面的已经摘过来，只留下 `.git/sequencer`，
 * 面板看不出有操作在进行，git 却认为有（git 2.43 实测）。
 */
function replayable(items: NonEmpty<CommitMenuTarget>): boolean {
  return items.length === 1 || items.every((item) => !item.merge);
}

const hashOf = (item: CommitMenuTarget): string => item.hash;

/** 提交列表的右键菜单项，顺序无关（菜单里的顺序由 `package.json` 的 `group` 定）。提交列表没有目录，看法都写原样看。 */
const COMMIT_MENU: readonly MenuItem<CommitMenuTarget>[] = [
  // 复制的文字由这里拼：完整 hash 一行一个（多选的复制都一行一个，项目负责人定）。
  menuItem({
    view: MenuView.Exact,
    key: MenuContextKey.CopyHash,
    pick: hashOf,
    value: (hashes) => ({ text: hashes.join("\n") }),
  }),
  // 选中是列表顺序（从新到旧）。cherry-pick 从旧到新摘，revert 从新到旧撤，同 IDEA。
  menuItem({
    view: MenuView.Exact,
    key: MenuContextKey.CherryPick,
    pick: (item) => item,
    whole: replayable,
    value: (items) => ({ hashes: items.map(hashOf).reverse() }),
  }),
  menuItem({
    view: MenuView.Exact,
    key: MenuContextKey.Revert,
    pick: (item) => item,
    whole: replayable,
    value: (items) => ({ hashes: items.map(hashOf) }),
  }),
  // 变基到一条提交：起点就是它，显示名用 7 位，和别处的短 hash 一样长。
  menuItem({
    view: MenuView.Exact,
    key: MenuContextKey.RebaseHere,
    pick: hashOf,
    whole: exactlyOne,
    value: ([hash]) => ({ start: hash, startName: hash.slice(0, 7) }),
  }),
  menuItem({
    view: MenuView.Exact,
    key: MenuContextKey.ResetTo,
    pick: hashOf,
    whole: exactlyOne,
    value: ([hash]) => ({ hash }),
  }),
  menuItem({
    view: MenuView.Exact,
    key: MenuContextKey.Reword,
    pick: (item) => (item.rewordable ? item.hash : undefined),
    whole: exactlyOne,
    value: ([hash]) => ({ hash }),
  }),
];

/** 选中的提交（列表顺序）→ 右键菜单上下文里各菜单项的键。 */
export function commitMenuContext(
  hashes: readonly string[],
  rewordable: ReadonlySet<string>,
  merges: ReadonlySet<string>,
): Record<string, MenuArgs> {
  return menuItemsContext(
    flatViews(
      hashes.map((hash) => ({ hash, rewordable: rewordable.has(hash), merge: merges.has(hash) })),
    ),
    COMMIT_MENU,
  );
}
