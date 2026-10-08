import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MenuContextKey, MenuNodeValue } from "@dummy-git/shared";
import { describe, expect, it } from "vitest";

/**
 * `package.json` 菜单项的 `when` 条件与页面写的 `data-vscode-context` 逐字对应（CLAUDE.md B.2）。
 * 改了一边忘了另一边，菜单项会悄悄不出现、不报任何错——这里守着。
 */
const manifest: unknown = JSON.parse(
  readFileSync(join(__dirname, "../../../package.json"), "utf8"),
);

function webviewMenuWhens(): string[] {
  const menus = JSON.stringify(manifest);
  return [...menus.matchAll(/"when":"([^"]*webviewId[^"]*)"/g)].map((m) => m[1] ?? "");
}

describe("右键菜单的 when 条件只用 shared/src/menu.ts 里定义的键与值", () => {
  it("用到的上下文键都有定义", () => {
    const keys = new Set<string>(Object.values(MenuContextKey));
    for (const when of webviewMenuWhens()) {
      // 去掉引号里的值（比如 'dummyGit.log'），剩下的 dummyGit.xxx 就是上下文键。
      const bare = when.replace(/'[^']*'/g, "");
      for (const [key] of bare.matchAll(/dummyGit\.\w+/g)) expect(keys).toContain(key);
    }
  });

  it("节点类型的取值都有定义", () => {
    const values = new Set<string>(Object.values(MenuNodeValue));
    for (const when of webviewMenuWhens()) {
      for (const [, value] of when.matchAll(/dummyGit\.node == '([^']*)'/g)) {
        expect(values).toContain(value);
      }
    }
  });

  it("至少有一个菜单项（防止正则失效后测试空转）", () => {
    expect(webviewMenuWhens().length).toBeGreaterThan(0);
  });
});
