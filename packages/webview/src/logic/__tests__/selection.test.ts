import { describe, expect, it } from "vitest";
import {
  contextMenuOn,
  EMPTY_SELECTION,
  extendTo,
  retain,
  type Selection,
  selectAll,
  selectOnly,
  singleOf,
  toggle,
} from "../selection.js";

const ORDER = ["a", "b", "c", "d", "e"];

/** 选中的 id 按显示顺序排好，断言好读。 */
function ids(selection: Selection): string[] {
  return ORDER.filter((id) => selection.ids.has(id));
}

describe("selectOnly：单击、↑↓", () => {
  it("只选这一行，锚点和光标都在它上面", () => {
    expect(selectOnly("c")).toEqual({ ids: new Set(["c"]), anchor: "c", cursor: "c" });
  });
});

describe("toggle：Ctrl+单击", () => {
  it("没选中的加进来，其余不动", () => {
    const s = toggle(selectOnly("a"), "c");
    expect(ids(s)).toEqual(["a", "c"]);
    expect([s.anchor, s.cursor]).toEqual(["c", "c"]);
  });

  it("已选中的移出去", () => {
    expect(ids(toggle(toggle(selectOnly("a"), "c"), "a"))).toEqual(["c"]);
  });

  it("移出最后一个，选中变空", () => {
    expect(ids(toggle(selectOnly("a"), "a"))).toEqual([]);
  });
});

describe("extendTo：Shift+单击、Shift+↑↓", () => {
  it("从锚点到这一行整段选中，替换原来的；锚点不动，光标到这一行", () => {
    const s = extendTo(toggle(selectOnly("e"), "b"), ORDER, "d", false);
    expect(ids(s)).toEqual(["b", "c", "d"]);
    expect([s.anchor, s.cursor]).toEqual(["b", "d"]);
  });

  it("往锚点上面选也行", () => {
    expect(ids(extendTo(selectOnly("d"), ORDER, "b", false))).toEqual(["b", "c", "d"]);
  });

  it("连按 Shift：每次都从同一个锚点算，范围可以缩回去", () => {
    const wide = extendTo(selectOnly("b"), ORDER, "e", false);
    expect(ids(extendTo(wide, ORDER, "c", false))).toEqual(["b", "c"]);
  });

  it("Ctrl+Shift+单击：这一段加进原来的选中", () => {
    const s = toggle(selectOnly("a"), "d");
    expect(ids(extendTo(s, ORDER, "e", true))).toEqual(["a", "d", "e"]);
  });

  it("没有锚点时当作单击", () => {
    expect(extendTo(EMPTY_SELECTION, ORDER, "c", false)).toEqual(selectOnly("c"));
  });

  it("锚点已不在列表里（被过滤掉了）时当作单击", () => {
    expect(extendTo(selectOnly("x"), ORDER, "c", false)).toEqual(selectOnly("c"));
  });
});

describe("selectAll：Ctrl+A", () => {
  it("全选看得见的行，锚点和光标不动", () => {
    const s = selectAll(selectOnly("c"), ORDER);
    expect(ids(s)).toEqual(ORDER);
    expect([s.anchor, s.cursor]).toEqual(["c", "c"]);
  });
});

describe("contextMenuOn：右键", () => {
  it("点在已选中的行上，选中不变", () => {
    const s = extendTo(selectOnly("a"), ORDER, "c", false);
    expect(contextMenuOn(s, "b")).toBe(s);
  });

  it("点在没选中的行上，改成只选这一行", () => {
    const s = extendTo(selectOnly("a"), ORDER, "c", false);
    expect(contextMenuOn(s, "e")).toEqual(selectOnly("e"));
  });
});

describe("retain：刷新、过滤之后", () => {
  it("还在的留着，不在的去掉", () => {
    const s = extendTo(selectOnly("a"), ORDER, "c", false);
    expect(ids(retain(s, ["a", "c", "d"]))).toEqual(["a", "c"]);
  });

  it("锚点、光标不在了就去掉，在的留着", () => {
    const s = extendTo(selectOnly("a"), ORDER, "c", false);
    expect(retain(s, ["b", "c"])).toEqual({ ids: new Set(["b", "c"]), cursor: "c" });
  });

  it("一个都不剩时选中为空，交给使用方决定选什么", () => {
    expect(retain(selectOnly("a"), ["b"])).toEqual({ ids: new Set() });
  });
});

describe("singleOf：恰好选中一行", () => {
  it("一行时是它", () => {
    expect(singleOf(selectOnly("b"))).toBe("b");
  });

  it("多行或没有时缺席", () => {
    expect(singleOf(toggle(selectOnly("a"), "b"))).toBeUndefined();
    expect(singleOf(EMPTY_SELECTION)).toBeUndefined();
  });
});
