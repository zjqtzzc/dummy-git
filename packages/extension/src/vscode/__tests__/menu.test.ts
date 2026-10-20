import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MenuContextKey } from "@dummy-git/shared";
import { describe, expect, it } from "vitest";

/**
 * `package.json` 的右键菜单项与页面写的 `data-vscode-context` 逐字对应：
 * 每个菜单项的键就是它的命令 id。改了一边忘了另一边，菜单项会悄悄不出现、不报任何错——这里守着。
 */
const manifest: unknown = JSON.parse(
  readFileSync(join(__dirname, "../../../package.json"), "utf8"),
);

interface MenuEntry {
  readonly command: string;
  readonly when: string;
}

function webviewMenu(): MenuEntry[] {
  const text = JSON.stringify(manifest);
  return [...text.matchAll(/\{"command":"([^"]*)","when":"(webviewId[^"]*)"/g)].map((m) => ({
    command: m[1] ?? "",
    when: m[2] ?? "",
  }));
}

describe("右键菜单项：键就是命令 id", () => {
  it("每一项的 when 只看自己那个键", () => {
    for (const { command, when } of webviewMenu()) {
      expect(when).toMatch(new RegExp(`^webviewId == '[^']*' && ${command.replace(".", "\\.")}$`));
    }
  });

  it("页面写的每个菜单键都有对应的菜单项", () => {
    const commands = new Set(webviewMenu().map((entry) => entry.command));
    for (const key of Object.values(MenuContextKey)) {
      if (key !== MenuContextKey.Repo) expect(commands).toContain(key);
    }
  });

  it("至少有一个菜单项（防止正则失效后测试空转）", () => {
    expect(webviewMenu().length).toBeGreaterThan(0);
  });
});
