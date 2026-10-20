import { describe, expect, it } from "vitest";
import {
  exactlyOne,
  flatViews,
  type MenuItem,
  MenuView,
  menuItem,
  menuItemsContext,
} from "../menuItems.js";

/** 测试用的东西：名字，能不能删。 */
interface Thing {
  readonly name: string;
  readonly deletable: boolean;
}

const a: Thing = { name: "a", deletable: true };
const b: Thing = { name: "b", deletable: true };
const locked: Thing = { name: "locked", deletable: false };

const ITEMS: readonly MenuItem<Thing>[] = [
  menuItem({
    view: MenuView.Exact,
    key: "copy",
    pick: (t: Thing) => t.name,
    value: (names) => ({ names }),
  }),
  menuItem({
    view: MenuView.Exact,
    key: "delete",
    pick: (t: Thing) => (t.deletable ? t.name : undefined),
    value: (names) => ({ names }),
  }),
  menuItem({
    view: MenuView.Exact,
    key: "rename",
    pick: (t: Thing) => t.name,
    whole: exactlyOne,
    value: ([name]) => ({ name }),
  }),
];

describe("menuItemsContext：每个菜单项一个键，全部严格", () => {
  it("每一个都能做：出现，值是全部", () => {
    expect(menuItemsContext(flatViews([a, b]), ITEMS)).toEqual({
      copy: { names: ["a", "b"] },
      delete: { names: ["a", "b"] },
    });
  });

  it("有一个不能做：这一项不出现，不跳过", () => {
    expect(menuItemsContext(flatViews([a, locked]), ITEMS)).toEqual({
      copy: { names: ["a", "locked"] },
    });
  });

  it("整体条件不满足：不出现；满足：出现", () => {
    expect(menuItemsContext(flatViews([a, b]), ITEMS)).not.toHaveProperty("rename");
    expect(menuItemsContext(flatViews([a]), ITEMS)).toHaveProperty("rename", { name: "a" });
  });

  it("值按选中的顺序", () => {
    expect(menuItemsContext(flatViews([b, a]), ITEMS)).toHaveProperty("copy", {
      names: ["b", "a"],
    });
  });

  it("什么都没选：一项都没有", () => {
    expect(menuItemsContext(flatViews([]), ITEMS)).toEqual({});
  });
});

describe("menuItemsContext：每一项用自己的看法", () => {
  const expandedOnly = menuItem({
    view: MenuView.Expanded,
    key: "deleteAll",
    pick: (t: Thing) => (t.deletable ? t.name : undefined),
    value: (names) => ({ names }),
  });
  const exactOnly = menuItem({
    view: MenuView.Exact,
    key: "rename",
    pick: (t: Thing) => t.name,
    whole: exactlyOne,
    value: ([name]) => ({ name }),
  });

  it("原样看与展开看各取各的", () => {
    // 好比点中一个目录 locked，它下面是 a、b：重命名看目录本身，删除看下面的叶子。
    const views = { exact: [locked], expanded: [a, b] };
    expect(menuItemsContext(views, [expandedOnly, exactOnly])).toEqual({
      deleteAll: { names: ["a", "b"] },
      rename: { name: "locked" },
    });
  });

  it("那种看法下什么都没有：不出现", () => {
    expect(menuItemsContext({ exact: [a], expanded: [] }, [expandedOnly])).toEqual({});
  });
});
