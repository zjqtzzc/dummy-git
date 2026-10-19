import { describe, expect, it } from "vitest";
import { containerMenuContext } from "../menuContext.js";

describe("containerMenuContext：右键时写到容器上的菜单上下文", () => {
  it("点在有菜单的行上：带上这一行的上下文", () => {
    expect(
      JSON.parse(containerMenuContext({ "dummyGit.node": "commit", "dummyGit.hash": "1a2b" })),
    ).toEqual({
      "dummyGit.node": "commit",
      "dummyGit.hash": "1a2b",
      preventDefaultContextMenuItems: true,
    });
  });

  it("点在空白处或没有菜单的行上：只拦掉浏览器默认项", () => {
    expect(JSON.parse(containerMenuContext(undefined))).toEqual({
      preventDefaultContextMenuItems: true,
    });
  });
});
