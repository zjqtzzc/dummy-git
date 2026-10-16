#!/usr/bin/env node
/**
 * 跑 vitest，终端照常显示，同时把完整输出存到 `.tmp/test-results/last.log`。
 *
 * 为什么要存：偶发失败往往来自测试之外的未处理错误（如某条和时间有关的测试留下的
 * rejection），vitest 会在输出里写明它来自哪个测试文件、最后在跑哪条测试——
 * 但那段输出一滚就没了，事后复现不出来就再也查不到。每次都落盘，失败那次就在那里。
 *
 * 参数原样转给 vitest（如 `pnpm test -- path/to/x.test.ts`）。退出码与 vitest 一致。
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const logFile = join(repoRoot, ".tmp", "test-results", "last.log");

// `pnpm test -- x.test.ts` 会把 `--` 也传进来，vitest 见了它就不再把后面当文件过滤。
const args = process.argv.slice(2).filter((arg) => arg !== "--");

const child = spawn("npx", ["vitest", "run", ...args], {
  cwd: repoRoot,
  // 输出经过管道后 vitest 会关掉颜色；终端是 TTY 时强制保留，文件里再剥掉。
  env: process.stdout.isTTY ? { ...process.env, FORCE_COLOR: "1" } : process.env,
  stdio: ["inherit", "pipe", "pipe"],
});

const chunks = [];
child.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
  chunks.push(chunk);
});
child.stderr.on("data", (chunk) => {
  process.stderr.write(chunk);
  chunks.push(chunk);
});

child.on("close", (code, signal) => {
  const text = stripVTControlCharacters(Buffer.concat(chunks).toString("utf8"));
  mkdirSync(dirname(logFile), { recursive: true });
  writeFileSync(logFile, `# ${new Date().toISOString()} exit=${code ?? signal}\n${text}`);
  process.exit(code ?? 1);
});
