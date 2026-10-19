import { MenuContextKey } from "@dummy-git/shared";
import {
  exactlyOne,
  type MenuItem,
  type MenuValue,
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

/** 提交列表的右键菜单项，顺序无关（菜单里的顺序由 `package.json` 的 `group` 定）。 */
const COMMIT_MENU: readonly MenuItem<CommitMenuTarget>[] = [
  { key: MenuContextKey.CopyHash, value: (items) => items.map((item) => item.hash) },
  // 选中是列表顺序（从新到旧）。cherry-pick 从旧到新摘，revert 从新到旧撤，同 IDEA。
  {
    key: MenuContextKey.CherryPick,
    whole: replayable,
    value: (items) => items.map((item) => item.hash).reverse(),
  },
  {
    key: MenuContextKey.Revert,
    whole: replayable,
    value: (items) => items.map((item) => item.hash),
  },
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
  merges: ReadonlySet<string>,
): Record<string, MenuValue> {
  return menuItemsContext(
    hashes.map((hash) => ({ hash, rewordable: rewordable.has(hash), merge: merges.has(hash) })),
    COMMIT_MENU,
  );
}
