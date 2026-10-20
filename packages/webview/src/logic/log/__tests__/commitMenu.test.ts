import { MenuContextKey } from "@dummy-git/shared";
import { describe, expect, it } from "vitest";
import { commitMenuContext } from "../commitMenu.js";

const NONE = new Set<string>();
const H1 = "1".repeat(40);
const H2 = "2".repeat(40);

describe("commitMenuContext：提交列表的右键菜单项", () => {
  it("一条能改说明的提交：全部菜单项都在，参数是它的 hash", () => {
    expect(commitMenuContext([H1], new Set([H1]), NONE)).toEqual({
      [MenuContextKey.CopyHash]: { text: H1 },
      [MenuContextKey.CherryPick]: { hashes: [H1] },
      [MenuContextKey.Revert]: { hashes: [H1] },
      [MenuContextKey.RebaseHere]: { start: H1, startName: H1.slice(0, 7) },
      [MenuContextKey.ResetTo]: { hash: H1 },
      [MenuContextKey.Reword]: { hash: H1 },
    });
  });

  it("一条不能改说明的提交：没有 Edit Commit Message", () => {
    expect(commitMenuContext([H1], NONE, NONE)).not.toHaveProperty(MenuContextKey.Reword);
  });

  it("多条（列表顺序从新到旧）：hash 一行一个；cherry-pick 从旧到新，revert 从新到旧；只能对一条做的不出现", () => {
    expect(commitMenuContext([H2, H1], new Set([H1, H2]), NONE)).toEqual({
      [MenuContextKey.CopyHash]: { text: `${H2}\n${H1}` },
      [MenuContextKey.CherryPick]: { hashes: [H1, H2] },
      [MenuContextKey.Revert]: { hashes: [H2, H1] },
    });
  });

  it("多条里有合并提交：没有 Cherry-Pick、Revert", () => {
    const context = commitMenuContext([H2, H1], NONE, new Set([H1]));
    expect(context).not.toHaveProperty(MenuContextKey.CherryPick);
    expect(context).not.toHaveProperty(MenuContextKey.Revert);
  });

  it("只有一条合并提交：照旧给，交给 git 拒绝", () => {
    expect(commitMenuContext([H1], NONE, new Set([H1]))).toHaveProperty(MenuContextKey.CherryPick, {
      hashes: [H1],
    });
  });
});
