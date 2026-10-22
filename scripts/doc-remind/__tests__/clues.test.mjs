import { describe, expect, it } from "vitest";
import {
  deletedNames,
  findClues,
  formatClues,
  MAX_LINES,
  mentionsFile,
  pathTokens,
} from "../clues.mjs";

const AUTO_FETCH = "packages/extension/src/core/autoFetch.ts";

/** 只给测试用到的文件名计数；没列的视为仓库里没有。 */
const counts = (entries) => new Map(Object.entries(entries));

/** 把文档写成 `{ path, lines }`，一行一个字符串。 */
const doc = (path, ...lines) => ({ path, lines });

/** 文档行里的路径写法有没有一个在说 `file`。 */
const lineMentions = (line, file, basenames = counts({})) =>
  pathTokens(line).filter((t) => mentionsFile(t, file, basenames));

describe("deletedNames：从 diff 的删除行里取名字", () => {
  const diff = [
    `diff --git a/${AUTO_FETCH} b/${AUTO_FETCH}`,
    "index 1111111..2222222 100644",
    `--- a/${AUTO_FETCH}`,
    `+++ b/${AUTO_FETCH}`,
    "@@ -3,4 +3,2 @@",
    '-  [CommitOrder.Date]: "--date-order",',
    "-export type PopupItem = { kind: PopupItemKind; label: string };",
    "-const AUTO_FETCH_INTERVAL_MS = 20 * MINUTE;",
    "-export function startAutoFetch(run: () => Promise<void>) {",
    "+export function beginAutoFetch(run: () => Promise<void>) {",
    "@@ -40 +38 @@",
    "-// 不带 --prune：见 HEAD",
    "+// 带 --prune-tags",
  ].join("\n");

  it("取驼峰、两段以上的帕斯卡、带下划线的全大写，以及 git 参数", () => {
    expect([...deletedNames(diff)].sort()).toEqual([
      "--date-order",
      "--prune",
      "AUTO_FETCH_INTERVAL_MS",
      "CommitOrder",
      "PopupItem",
      "PopupItemKind",
      "startAutoFetch",
    ]);
  });

  it("文件头的 `--- a/<路径>` 不算删除行，路径里的 autoFetch 不会混进来", () => {
    expect(deletedNames(diff).has("autoFetch")).toBe(false);
  });

  it("词中间的 `--` 不是 git 参数：fsmonitor--daemon 里取不出 --daemon", () => {
    const names = deletedNames('@@ -76 +76 @@\n-    relPath.startsWith("fsmonitor--daemon/") ||');
    expect([...names].sort()).toEqual(["relPath", "startsWith"]);
  });

  it("改动前后都还在的名字不算：只改了值、挪到别处的不算，改掉的旧名字算", () => {
    const changed = [
      "@@ -2 +1,0 @@",
      '-import { AUTO_FETCH_INTERVAL_MS, startAutoFetch } from "./fetch.js";',
      "@@ -11 +10 @@",
      "-export const AUTO_FETCH_INTERVAL_MS = 20 * 60 * 1000;",
      "+export const AUTO_FETCH_INTERVAL_MS = 30 * 60 * 1000;",
      "@@ -13 +12,2 @@",
      "-export function startAutoFetch(",
      "+export function beginAutoFetch(",
      '+import { startAutoFetch } from "./fetch.js";',
    ].join("\n");
    expect([...deletedNames(changed)]).toEqual([]);
    expect([
      ...deletedNames(changed.replace('+import { startAutoFetch } from "./fetch.js";', "")),
    ]).toEqual(["startAutoFetch"]);
  });

  it("没有删除行（新文件、只加行）时为空", () => {
    expect(
      deletedNames(`--- /dev/null\n+++ b/${AUTO_FETCH}\n@@ -0,0 +1 @@\n+export const x = 1;`).size,
    ).toBe(0);
  });
});

describe("mentionsFile：文档里的各种路径写法对上改动的文件", () => {
  it("完整路径、省掉前缀的路径都对得上", () => {
    expect(lineMentions(`截断上限在 \`${AUTO_FETCH}\` 开头`, AUTO_FETCH)).toEqual([AUTO_FETCH]);
    expect(lineMentions("（`core/autoFetch.ts` 的 `AUTO_FETCH_INTERVAL_MS`）", AUTO_FETCH)).toEqual(
      ["core/autoFetch.ts"],
    );
    expect(
      lineMentions(
        "改 `ui/ToolButton.vue`、`ui/MenuButton.vue` 前先读本文",
        "packages/webview/src/ui/ToolButton.vue",
      ),
    ).toEqual(["ui/ToolButton.vue"]);
    expect(
      lineMentions(
        "| `logic/popupMenu.ts`、`logic/popupPlacement.ts` |",
        "packages/webview/src/logic/popupMenu.ts",
      ),
    ).toEqual(["logic/popupMenu.ts"]);
  });

  it("目录写法对上目录里（含子目录）的文件", () => {
    const line =
      "| `webview/src/log/`、`webview/src/logic/log/`（提交列表） | `product/features/log.md` |";
    expect(lineMentions(line, "packages/webview/src/log/LogApp.vue")).toEqual(["webview/src/log/"]);
    expect(lineMentions(line, "packages/webview/src/logic/log/graph/rows.ts")).toEqual([
      "webview/src/logic/log/",
    ]);
    expect(
      lineMentions("见 `packages/webview/src/log/`", "packages/webview/src/log/LogApp.vue"),
    ).toEqual(["packages/webview/src/log/"]);
  });

  it("按路径段比，不按字符串比：log/ 不会对上 dialog/", () => {
    expect(
      lineMentions("`log/GraphCell.vue`", "packages/webview/src/dialog/GraphCell.vue"),
    ).toEqual([]);
    expect(lineMentions("`webview/src/log/`", "packages/webview/src/dialog/X.vue")).toEqual([]);
  });

  it("只写文件名：仓库里唯一时对得上，有同名文件时不算", () => {
    const line = "改 `logic/log/graph/`、`refLabels.ts`、`GraphCell.vue` 前先读本文";
    const file = "packages/webview/src/logic/log/refLabels.ts";
    expect(lineMentions(line, file, counts({ "refLabels.ts": 1 }))).toEqual(["refLabels.ts"]);
    expect(lineMentions(line, file, counts({ "refLabels.ts": 2 }))).toEqual([]);
  });
});

describe("mentionsFile：泛泛提到一整层的写法不算", () => {
  it("只有一段的目录名（core/、ipc/）不算", () => {
    const line =
      "| `core/` `ipc/` `vscode/` `extension.ts` 只许从 `git/commands/index.ts` 引入 git 命令 | lint |";
    expect(lineMentions(line, AUTO_FETCH)).toEqual([]);
    expect(lineMentions(line, "packages/extension/src/ipc/brief.ts")).toEqual([]);
  });

  it("只有一段的 tree/ 不算，写到第二段的 logic/tree/ 算", () => {
    const line = "改 `tree/`、`logic/tree/`、`vscode/diff.ts` 前先读本文";
    expect(lineMentions(line, "packages/webview/src/tree/Tree.vue")).toEqual([]);
    expect(lineMentions(line, "packages/webview/src/logic/tree/tree.ts")).toEqual(["logic/tree/"]);
  });

  it("带 * 的通配不算", () => {
    expect(
      lineMentions(
        "| `packages/extension/src/git/**` 不得 import `vscode` |",
        "packages/extension/src/git/cli.ts",
      ),
    ).toEqual([]);
  });
});

describe("findClues：在文档里找线索", () => {
  it("名字按词边界比：删掉 PopupItem 不会找到 PopupItemKind，删掉 --prune 不会找到 --prune-tags", () => {
    const docs = [
      doc("docs/a.md", "选单项是 `PopupItem`", "种类是 `PopupItemKind`"),
      doc("docs/b.md", "带 `--prune-tags`", "不带 `--prune`"),
    ];
    const clues = findClues(AUTO_FETCH, new Set(["PopupItem", "--prune"]), docs, counts({}));
    expect(clues.map((c) => `${c.doc}:${c.line} ${c.mentions.join(",")}`)).toEqual([
      "docs/a.md:1 PopupItem",
      "docs/b.md:2 --prune",
    ]);
  });

  it("一行同时提到路径和名字时只出一条，提到路径的排在只提到名字的前面", () => {
    const docs = [
      doc("docs/a.md", "间隔见 `AUTO_FETCH_INTERVAL_MS`"),
      doc("docs/b.md", "（`core/autoFetch.ts` 的 `AUTO_FETCH_INTERVAL_MS`）"),
    ];
    const clues = findClues(AUTO_FETCH, new Set(["AUTO_FETCH_INTERVAL_MS"]), docs, counts({}));
    expect(clues.map((c) => `${c.doc}:${c.line} ${c.mentions.join(",")}`)).toEqual([
      "docs/b.md:1 core/autoFetch.ts,AUTO_FETCH_INTERVAL_MS",
      "docs/a.md:1 AUTO_FETCH_INTERVAL_MS",
    ]);
  });
});

describe("formatClues：输出", () => {
  it("没有线索时是空串", () => {
    expect(formatClues(AUTO_FETCH, [])).toBe("");
  });

  it(`超过 ${MAX_LINES} 行只列前 ${MAX_LINES} 行，其余报个数；提到路径的不会被截掉`, () => {
    const lines = Array.from({ length: 24 }, (_, i) => `第 ${i} 行提到 \`startAutoFetch\``);
    const docs = [doc("docs/names.md", ...lines), doc("docs/zz.md", "见 `core/autoFetch.ts`")];
    const text = formatClues(
      AUTO_FETCH,
      findClues(AUTO_FETCH, new Set(["startAutoFetch"]), docs, counts({})),
    );
    const out = text.split("\n");
    expect(out.length).toBe(1 + MAX_LINES + 1);
    expect(out[0]).toBe(`以下文档提到了 ${AUTO_FETCH} 或其中删改的名字，可能需要一起改：`);
    expect(out[1]).toBe("docs/zz.md:1 提到 core/autoFetch.ts");
    expect(out[2]).toBe("docs/names.md:1 提到 startAutoFetch");
    expect(out.at(-1)).toBe("还有 5 处");
  });
});
