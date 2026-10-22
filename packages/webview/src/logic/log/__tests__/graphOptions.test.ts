import { CommitOrder } from "@dummy-git/shared";
import { describe, expect, it } from "vitest";
import { PopupItemKind } from "../../popupMenu.js";
import { graphOptionsMenu, restoreOrder, saveOrder } from "../graphOptions.js";

describe("存、读回排序", () => {
  it("存了再读回，原样；落盘的是映射表里的字符串", () => {
    for (const order of Object.values(CommitOrder))
      expect(restoreOrder(saveOrder(order))).toBe(order);
    expect(saveOrder(CommitOrder.Topo)).toBe("topo");
  });

  it("什么都没存、认不出：按提交时间", () => {
    expect(restoreOrder(undefined)).toBe(CommitOrder.Date);
    expect(restoreOrder("intellisort")).toBe(CommitOrder.Date);
  });
});

describe("graphOptionsMenu", () => {
  it("一节 Sort，两个单选项，选中的是当前的；选了交回那一种", () => {
    const chosen: CommitOrder[] = [];
    const [title, byDate, topo] = graphOptionsMenu(CommitOrder.Date, (order) => chosen.push(order));
    expect(title).toEqual({ kind: PopupItemKind.Separator, label: "Sort" });
    if (byDate?.kind !== PopupItemKind.Radio || topo?.kind !== PopupItemKind.Radio) {
      throw new Error("应是单选项");
    }
    expect([byDate.label, byDate.selected, topo.label, topo.selected]).toEqual([
      "By Commit Date",
      true,
      "Topologically",
      false,
    ]);
    topo.select();
    expect(chosen).toEqual([CommitOrder.Topo]);
  });
});
