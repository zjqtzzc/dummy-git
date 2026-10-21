import { assertNever } from "@dummy-git/shared";

/**
 * 图标按钮的浮层选单：用的地方交出一组选单项，按钮管弹出、定位、收起（`ui/MenuButton.vue`）。
 * 和右键菜单（`menuItems.ts`，VS Code 原生的 `webview/context`）是两回事。
 */

export enum PopupItemKind {
  /** 点了执行，整串选单收起。 */
  Action = "action",
  /** 点了切换开关，选单不收起，可以连着勾几项。 */
  Toggle = "toggle",
  /** 二级选单：里面再装一组选单项。 */
  Submenu = "submenu",
  /** 分隔线；带 `label` 就是一节的小标题。 */
  Separator = "separator",
}

export type PopupItem =
  | {
      readonly kind: PopupItemKind.Action;
      readonly label: string;
      readonly disabled?: boolean;
      readonly run: () => void;
    }
  | {
      readonly kind: PopupItemKind.Toggle;
      readonly label: string;
      readonly checked: boolean;
      readonly disabled?: boolean;
      readonly toggle: (on: boolean) => void;
    }
  | {
      readonly kind: PopupItemKind.Submenu;
      readonly label: string;
      readonly disabled?: boolean;
      readonly items: readonly PopupItem[];
    }
  | { readonly kind: PopupItemKind.Separator; readonly label?: string };

/** 点了一项之后选单怎么样。 */
export enum PopupClick {
  /** 整串收起。 */
  Close = "close",
  /** 留着。 */
  Stay = "stay",
}

/**
 * 点了一项：该执行的执行、该切换的切换，返回选单收不收起。
 * 置灰的项、分隔线什么都不做；二级选单项不在这里打开（悬停与点击打开它由选单自己管）。
 */
export function clickPopupItem(item: PopupItem): PopupClick {
  switch (item.kind) {
    case PopupItemKind.Action:
      if (item.disabled === true) return PopupClick.Stay;
      item.run();
      return PopupClick.Close;
    case PopupItemKind.Toggle:
      if (item.disabled !== true) item.toggle(!item.checked);
      return PopupClick.Stay;
    case PopupItemKind.Submenu:
    case PopupItemKind.Separator:
      return PopupClick.Stay;
    default:
      return assertNever(item, "clickPopupItem");
  }
}

/**
 * 开着的那一串二级选单：每一级开着的那一项的序号，从一级选单起。`[2, 0]` 是一级的第 3 项开着、它的第 1 项也开着。
 * 空数组是只有一级选单。
 */
export type OpenPath = readonly number[];

/** 鼠标停在二级选单项上多久才打开（同 VS Code 的 `SubmenuMenuActionViewItem`）。 */
export const SUBMENU_OPEN_DELAY = 250;
/** 移到同一级别的项上，开着的二级选单多久才关：这期间鼠标进了二级选单就不关，斜着移过去不误关。 */
export const SUBMENU_CLOSE_DELAY = 750;

/** 等一会儿之后，开着的那一串改成什么。 */
export interface HoverPlan {
  readonly path: OpenPath;
  readonly delay: number;
}

/** 第 `level` 级第 `index` 项是能打开的二级选单项时，开着的那一串改成什么（到这一级为止，再打开它）。 */
function pathThrough(path: OpenPath, level: number, index: number, item: PopupItem): OpenPath {
  const kept = path.slice(0, level);
  return item.kind === PopupItemKind.Submenu && item.disabled !== true ? [...kept, index] : kept;
}

/**
 * 鼠标停到第 `level` 级第 `index` 项上：等多久、之后开着的那一串改成什么。不用改时缺席（调用方同时取消等着的那次）。
 * 要打开二级选单（或换成同级别的另一个）等 `SUBMENU_OPEN_DELAY`；只是关掉下面开着的等 `SUBMENU_CLOSE_DELAY`。
 */
export function planHover(
  path: OpenPath,
  level: number,
  index: number,
  item: PopupItem,
): HoverPlan | undefined {
  const next = pathThrough(path, level, index, item);
  if (next.length === path.length && next.every((step, i) => step === path[i])) return undefined;
  return { path: next, delay: next.length > level ? SUBMENU_OPEN_DELAY : SUBMENU_CLOSE_DELAY };
}

/** 点了第 `level` 级第 `index` 项：是二级选单项就立刻打开它；否则开着的那一串不变。 */
export function pathAfterClick(
  path: OpenPath,
  level: number,
  index: number,
  item: PopupItem,
): OpenPath {
  return item.kind === PopupItemKind.Submenu && item.disabled !== true
    ? pathThrough(path, level, index, item)
    : path;
}

/** 开着的每一级各显示哪些选单项：第 0 个是一级选单，之后顺着 `path` 往下。走不通的地方（选单项变了）就停。 */
export function openLevels(items: readonly PopupItem[], path: OpenPath): (readonly PopupItem[])[] {
  const levels: (readonly PopupItem[])[] = [items];
  let current = items;
  for (const index of path) {
    const item = current[index];
    if (item?.kind !== PopupItemKind.Submenu) break;
    current = item.items;
    levels.push(current);
  }
  return levels;
}
