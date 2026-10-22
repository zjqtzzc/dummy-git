import { CommitOrder } from "@dummy-git/shared";
import { type PopupItem, PopupItemKind } from "../popupMenu.js";

/** Graph Options 里的顺序与文字（同 IDEA 的 `Sort` 一节：`VcsLogBundle` 的 `graph.sort.off`、`graph.sort.standard`）。 */
const ORDER_MENU: readonly { readonly order: CommitOrder; readonly label: string }[] = [
  { order: CommitOrder.Date, label: "By Commit Date" },
  { order: CommitOrder.Topo, label: "Topologically" },
];

/** 存进 `viewState` 的写法：存下来的值会离开这次构建，enum 的值不直接落盘。 */
const SAVED_ORDER: Readonly<Record<CommitOrder, string>> = {
  [CommitOrder.Date]: "date",
  [CommitOrder.Topo]: "topo",
};

export function saveOrder(order: CommitOrder): unknown {
  return SAVED_ORDER[order];
}

/** 读回存下的排序。什么都没存、认不出时按提交时间（同 IDEA 的默认）。 */
export function restoreOrder(saved: unknown): CommitOrder {
  return (
    Object.values(CommitOrder).find((order) => SAVED_ORDER[order] === saved) ?? CommitOrder.Date
  );
}

/** Graph Options 的选单项：一节 `Sort`，两种排序是单选。 */
export function graphOptionsMenu(
  current: CommitOrder,
  select: (order: CommitOrder) => void,
): PopupItem[] {
  return [
    { kind: PopupItemKind.Separator, label: "Sort" },
    ...ORDER_MENU.map(
      (entry): PopupItem => ({
        kind: PopupItemKind.Radio,
        label: entry.label,
        selected: entry.order === current,
        select: () => select(entry.order),
      }),
    ),
  ];
}
