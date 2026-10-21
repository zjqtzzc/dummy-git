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
