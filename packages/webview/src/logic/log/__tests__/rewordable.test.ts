import { describe, expect, it } from "vitest";
import { rewordable } from "../rewordable.js";

const commit = (hash: string, ...parents: string[]) => ({ hash, parents, at: 0 });

describe("rewordable", () => {
  it("一条直线：HEAD 到根提交都能改", () => {
    const skeleton = [commit("c", "b"), commit("b", "a"), commit("a")];
    expect([...rewordable(skeleton, "c")]).toEqual(["c", "b", "a"]);
  });

  it("走到合并提交就停，它自己与更早的都不能改；别的分支上的也不能", () => {
    const skeleton = [
      commit("d", "c"),
      commit("c", "b", "x"),
      commit("x", "a"),
      commit("b", "a"),
      commit("a"),
    ];
    expect([...rewordable(skeleton, "d")]).toEqual(["d"]);
  });

  it("HEAD 不在骨架里（按别的分支过滤）：一条都没有", () => {
    expect(rewordable([commit("a")], "z").size).toBe(0);
  });
});
