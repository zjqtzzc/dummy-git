import { MenuContextKey } from "@dummy-git/shared";
import { describe, expect, it } from "vitest";
import { commitMenuContext } from "../commitMenu.js";

const NONE = new Set<string>();

describe("commitMenuContext：提交列表的右键菜单项", () => {
  it("一条能改说明的提交：全部菜单项都在，值是它的 hash", () => {
    expect(commitMenuContext(["h1"], new Set(["h1"]), NONE)).toEqual({
      [MenuContextKey.CopyHash]: ["h1"],
      [MenuContextKey.CherryPick]: ["h1"],
      [MenuContextKey.Revert]: ["h1"],
      [MenuContextKey.RebaseHere]: "h1",
      [MenuContextKey.ResetTo]: "h1",
      [MenuContextKey.Reword]: "h1",
    });
  });

  it("一条不能改说明的提交：没有 Edit Commit Message", () => {
    expect(commitMenuContext(["h1"], NONE, NONE)).not.toHaveProperty(MenuContextKey.Reword);
  });

  it("多条（列表顺序从新到旧）：cherry-pick 从旧到新，revert 从新到旧；只能对一条做的不出现", () => {
    expect(commitMenuContext(["h2", "h1"], new Set(["h1", "h2"]), NONE)).toEqual({
      [MenuContextKey.CopyHash]: ["h2", "h1"],
      [MenuContextKey.CherryPick]: ["h1", "h2"],
      [MenuContextKey.Revert]: ["h2", "h1"],
    });
  });

  it("多条里有合并提交：没有 Cherry-Pick、Revert", () => {
    const context = commitMenuContext(["h2", "m"], NONE, new Set(["m"]));
    expect(context).not.toHaveProperty(MenuContextKey.CherryPick);
    expect(context).not.toHaveProperty(MenuContextKey.Revert);
  });

  it("只有一条合并提交：照旧给，交给 git 拒绝", () => {
    expect(commitMenuContext(["m"], NONE, new Set(["m"]))).toHaveProperty(
      MenuContextKey.CherryPick,
      ["m"],
    );
  });
});
