import { MenuContextKey } from "@dummy-git/shared";
import { exactlyOne, type MenuItem, type MenuValue, menuItemsContext } from "../menuItems.js";

/** 提交列表的一行，菜单项要用的那几样。 */
export interface CommitMenuTarget {
  readonly hash: string;
  /** 能改说明（`rewordable`）。 */
  readonly rewordable: boolean;
}

/** 提交列表的右键菜单项，顺序无关（菜单里的顺序由 `package.json` 的 `group` 定）。 */
const COMMIT_MENU: readonly MenuItem<CommitMenuTarget>[] = [
  { key: MenuContextKey.CopyHash, value: (items) => items.map((item) => item.hash) },
  { key: MenuContextKey.CherryPick, whole: exactlyOne, value: ([item]) => item.hash },
  { key: MenuContextKey.Revert, whole: exactlyOne, value: ([item]) => item.hash },
  { key: MenuContextKey.RebaseHere, whole: exactlyOne, value: ([item]) => item.hash },
  { key: MenuContextKey.ResetTo, whole: exactlyOne, value: ([item]) => item.hash },
  {
    key: MenuContextKey.Reword,
    accepts: (item) => item.rewordable,
    whole: exactlyOne,
    value: ([item]) => item.hash,
  },
];

/** 选中的提交（列表顺序）→ 右键菜单上下文里各菜单项的键。 */
export function commitMenuContext(
  hashes: readonly string[],
  rewordable: ReadonlySet<string>,
): Record<string, MenuValue> {
  return menuItemsContext(
    hashes.map((hash) => ({ hash, rewordable: rewordable.has(hash) })),
    COMMIT_MENU,
  );
}
