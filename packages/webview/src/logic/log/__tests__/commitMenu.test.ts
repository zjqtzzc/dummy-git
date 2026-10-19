import { MenuContextKey } from "@dummy-git/shared";
import { describe, expect, it } from "vitest";
import { commitMenuContext } from "../commitMenu.js";

describe("commitMenuContext：提交列表的右键菜单项", () => {
  it("一条能改说明的提交：全部菜单项都在，值是它的 hash", () => {
    expect(commitMenuContext(["h1"], new Set(["h1"]))).toEqual({
      [MenuContextKey.CopyHash]: ["h1"],
      [MenuContextKey.CherryPick]: "h1",
      [MenuContextKey.Revert]: "h1",
      [MenuContextKey.RebaseHere]: "h1",
      [MenuContextKey.ResetTo]: "h1",
      [MenuContextKey.Reword]: "h1",
    });
  });

  it("一条不能改说明的提交：没有 Edit Commit Message", () => {
    expect(commitMenuContext(["h1"], new Set())).not.toHaveProperty(MenuContextKey.Reword);
  });

  it("多条：只有 Copy Hash，hash 按列表顺序", () => {
    expect(commitMenuContext(["h2", "h1"], new Set(["h1", "h2"]))).toEqual({
      [MenuContextKey.CopyHash]: ["h2", "h1"],
    });
  });
});
