import { describe, expect, it } from "vitest";
import { exactlyOne, type MenuItem, menuItem, menuItemsContext } from "../menuItems.js";

/** 测试用的东西：名字，能不能删。 */
interface Thing {
  readonly name: string;
  readonly deletable: boolean;
}

const a: Thing = { name: "a", deletable: true };
const b: Thing = { name: "b", deletable: true };
const locked: Thing = { name: "locked", deletable: false };

const ITEMS: readonly MenuItem<Thing>[] = [
  menuItem({ key: "copy", pick: (t: Thing) => t.name, value: (names) => ({ names }) }),
  menuItem({
    key: "delete",
    pick: (t: Thing) => (t.deletable ? t.name : undefined),
    value: (names) => ({ names }),
  }),
  menuItem({
    key: "rename",
    pick: (t: Thing) => t.name,
    whole: exactlyOne,
    value: ([name]) => ({ name }),
  }),
];

describe("menuItemsContext：每个菜单项一个键，全部严格", () => {
  it("每一个都能做：出现，值是全部", () => {
    expect(menuItemsContext([a, b], ITEMS)).toEqual({
      copy: { names: ["a", "b"] },
      delete: { names: ["a", "b"] },
    });
  });

  it("有一个不能做：这一项不出现，不跳过", () => {
    expect(menuItemsContext([a, locked], ITEMS)).toEqual({ copy: { names: ["a", "locked"] } });
  });

  it("整体条件不满足：不出现；满足：出现", () => {
    expect(menuItemsContext([a, b], ITEMS)).not.toHaveProperty("rename");
    expect(menuItemsContext([a], ITEMS)).toHaveProperty("rename", { name: "a" });
  });

  it("值按选中的顺序", () => {
    expect(menuItemsContext([b, a], ITEMS)).toHaveProperty("copy", { names: ["b", "a"] });
  });

  it("什么都没选：一项都没有", () => {
    expect(menuItemsContext([], ITEMS)).toEqual({});
  });
});
