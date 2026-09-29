#!/usr/bin/env node
/**
 * 从本机 VS Code 自带的 Seti 图标主题生成快照（`ARCHITECTURE.md` 第 5 题）。
 * 输出到 `packages/webview/src/seti/`，提交进仓库；VS Code 更新了 Seti 就重跑。
 *
 *   node scripts/generate-seti.mjs [VS Code 的 extensions 目录]
 *
 * 不给目录时依次试 Linux 与 macOS 的默认安装位置。
 *
 * ## 输出
 *
 * - `seti.woff`：字体，原样复制。
 * - `setiMap.json`：`defs`（图标 id → 字形与颜色）、`dark` / `light` 各一套
 *   `file`（默认）、`fileNames`、`fileExtensions`（值是图标 id）。
 *
 * ## 按语言的规则事先展开
 *
 * Seti 有一部分规则按语言写（`typescript → _typescript`），而「哪些扩展名算 typescript」
 * 由各个内置语言扩展声明。webview 里没有这些信息，所以这里读所有内置扩展的
 * `contributes.languages`，把语言规则展开成扩展名与文件名。主题里显式写的
 * `fileExtensions` / `fileNames` 优先级更高，后写覆盖。
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CANDIDATES = [
  "/usr/share/code/resources/app/extensions",
  "/Applications/Visual Studio Code.app/Contents/Resources/app/extensions",
];
const extensionsDir =
  process.argv[2] ?? CANDIDATES.find((dir) => existsSync(join(dir, "theme-seti")));
if (extensionsDir === undefined) {
  console.error("找不到 VS Code 的 extensions 目录，请作为参数传入。");
  process.exit(1);
}

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(repoRoot, "packages", "webview", "src", "seti");
const themeDir = join(extensionsDir, "theme-seti", "icons");
const theme = JSON.parse(readFileSync(join(themeDir, "vs-seti-icon-theme.json"), "utf8"));

/** 语言 id → 它声明的扩展名（去掉开头的点、转小写）与文件名（小写）。 */
const languages = new Map();
for (const entry of readdirSync(extensionsDir)) {
  const manifest = join(extensionsDir, entry, "package.json");
  if (!existsSync(manifest)) continue;
  for (const lang of JSON.parse(readFileSync(manifest, "utf8")).contributes?.languages ?? []) {
    const known = languages.get(lang.id) ?? { extensions: new Set(), filenames: new Set() };
    for (const ext of lang.extensions ?? [])
      known.extensions.add(ext.replace(/^\./, "").toLowerCase());
    for (const name of lang.filenames ?? []) known.filenames.add(name.toLowerCase());
    languages.set(lang.id, known);
  }
}

/** 一套映射：先铺语言规则，再用主题显式规则覆盖。 */
function mapping(section) {
  const fileExtensions = {};
  const fileNames = {};
  for (const [languageId, icon] of Object.entries(section.languageIds ?? {})) {
    const known = languages.get(languageId);
    if (known === undefined) continue;
    for (const ext of known.extensions) fileExtensions[ext] = icon;
    for (const name of known.filenames) fileNames[name] = icon;
  }
  for (const [ext, icon] of Object.entries(section.fileExtensions ?? {}))
    fileExtensions[ext.toLowerCase()] = icon;
  for (const [name, icon] of Object.entries(section.fileNames ?? {}))
    fileNames[name.toLowerCase()] = icon;
  return { file: section.file, fileNames, fileExtensions };
}

const dark = mapping(theme);
const light = mapping({
  file: theme.light?.file ?? theme.file,
  languageIds: { ...theme.languageIds, ...theme.light?.languageIds },
  fileExtensions: { ...theme.fileExtensions, ...theme.light?.fileExtensions },
  fileNames: { ...theme.fileNames, ...theme.light?.fileNames },
});

const defs = {};
for (const [id, def] of Object.entries(theme.iconDefinitions)) {
  // 主题里写的是 `\E001` 这样的转义文本，转成真正的字符。
  const char = String.fromCodePoint(Number.parseInt(def.fontCharacter.replace(/^\\/, ""), 16));
  defs[id] = { char, color: def.fontColor ?? "" };
}

mkdirSync(outDir, { recursive: true });
copyFileSync(join(themeDir, "seti.woff"), join(outDir, "seti.woff"));
writeFileSync(join(outDir, "setiMap.json"), `${JSON.stringify({ defs, dark, light })}\n`);
console.log(
  `已生成 ${outDir}：${Object.keys(defs).length} 个图标，` +
    `${Object.keys(dark.fileExtensions).length} 个扩展名，${Object.keys(dark.fileNames).length} 个文件名`,
);
