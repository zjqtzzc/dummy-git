#!/usr/bin/env node
/**
 * 把扩展打成 .vsix，放在 `.tmp/<name>-<version>.vsix`，最后一行输出它的路径。
 * 本地和发布 workflow 都跑这一个脚本，两边打出来的包是同一个做法。
 *
 * 生产构建不在这里跑：vsce 会先执行扩展的 `vscode:prepublish`，它先清空 dist 再构建。
 * `dependencies: false`：esbuild 已把依赖打进 dist；不关的话 vsce 会去收集 pnpm 的软链依赖。
 */
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createVSIX } from "@vscode/vsce";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const extensionDir = join(repoRoot, "packages", "extension");
const { name, version } = JSON.parse(readFileSync(join(extensionDir, "package.json"), "utf8"));

// vsce 不建输出目录，新克隆的仓库里还没有 .tmp。
const outDir = join(repoRoot, ".tmp");
mkdirSync(outDir, { recursive: true });
const packagePath = join(outDir, `${name}-${version}.vsix`);

await createVSIX({ cwd: extensionDir, packagePath, dependencies: false });
console.log(packagePath);
