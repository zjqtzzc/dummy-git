#!/usr/bin/env node
/**
 * 把「写命令排队、读命令直跑」这件事**看见**。
 *
 *   node scripts/demo-queue.mjs
 *
 * **这不是测试**：没有断言，不会失败，不进 `pnpm check`。
 * 存在的理由：并发是本项目唯一「读代码看不出对错」的地方，必须跑起来观察。
 *
 * 动作用定时器假装成 git 命令（固定 120ms），不真的起子进程——
 * 这一步验的是**调度**，不是 git。真命令接进来是第 5 步的事。
 *
 * 看三件事：
 *   ① 三条写命令同时发起 → 开始时刻应当依次错开约 120ms
 *   ② 三条读命令同时发起 → 开始时刻应当几乎同时（都是 0ms）
 *   ③ 中间一条写命令失败 → 后面的写命令**仍然要跑**（链不能被掐死）
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const OUT = mkdtempSync(join(tmpdir(), "demo-queue-"));

async function load(relPath, name) {
  const outfile = join(OUT, `${name}.mjs`);
  await build({
    entryPoints: [join(ROOT, relPath)],
    bundle: true,
    format: "esm",
    platform: "node",
    external: ["node:*"],
    outfile,
    logLevel: "error",
  });
  return import(outfile);
}

const { CommandQueue } = await load("packages/extension/src/core/operation.ts", "operation");
const { LockPolicy } = await load("packages/extension/src/git/commands/lock.ts", "lock");

const WRITE = LockPolicy.Exclusive;
const READ = LockPolicy.None;

const DURATION = 120;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 造一个假的 git 命令：记下它什么时候开始、什么时候结束。 */
function fakeCommand(label, timeline, t0, { fail = false } = {}) {
  return async () => {
    timeline.push({ label, event: "开始", at: Date.now() - t0 });
    await sleep(DURATION);
    timeline.push({ label, event: "结束", at: Date.now() - t0 });
    if (fail) throw new Error(`${label} 故意失败`);
    return label;
  };
}

function printTimeline(title, timeline, note) {
  console.log(`\n${title}`);
  console.log("─".repeat(64));
  for (const e of timeline) {
    const bar = "·".repeat(Math.round(e.at / 10));
    console.log(`  ${String(e.at).padStart(4)} ms  ${bar}${e.label} ${e.event}`);
  }
  console.log(`  → ${note}`);
}

// ── ① 三条写命令同时发起 ──────────────────────────────────────────
{
  const q = new CommandQueue();
  const timeline = [];
  const t0 = Date.now();
  await Promise.all([
    q.run(WRITE, fakeCommand("写A", timeline, t0)),
    q.run(WRITE, fakeCommand("写B", timeline, t0)),
    q.run(WRITE, fakeCommand("写C", timeline, t0)),
  ]);
  const starts = timeline.filter((e) => e.event === "开始").map((e) => e.at);
  printTimeline(
    "① 三条写命令同时发起",
    timeline,
    `开始时刻 ${starts.join(" / ")} ms —— 依次错开约 ${DURATION}ms，说明真的排了队`,
  );
}

// ── ② 三条读命令同时发起 ──────────────────────────────────────────
{
  const q = new CommandQueue();
  const timeline = [];
  const t0 = Date.now();
  await Promise.all([
    q.run(READ, fakeCommand("读A", timeline, t0)),
    q.run(READ, fakeCommand("读B", timeline, t0)),
    q.run(READ, fakeCommand("读C", timeline, t0)),
  ]);
  const starts = timeline.filter((e) => e.event === "开始").map((e) => e.at);
  printTimeline(
    "② 三条读命令同时发起",
    timeline,
    `开始时刻 ${starts.join(" / ")} ms —— 几乎同时，读命令连队都不排`,
  );
}

// ── ③ 中间一条写命令失败 ──────────────────────────────────────────
{
  const q = new CommandQueue();
  const timeline = [];
  const t0 = Date.now();
  const results = await Promise.allSettled([
    q.run(WRITE, fakeCommand("写A", timeline, t0)),
    q.run(WRITE, fakeCommand("写B(失败)", timeline, t0, { fail: true })),
    q.run(WRITE, fakeCommand("写C", timeline, t0)),
  ]);
  printTimeline(
    "③ 中间一条失败，后面的还跑不跑",
    timeline,
    `结果依次为 ${results.map((r) => r.status).join(" / ")} —— 写C 仍然跑了，链没被掐死`,
  );
}

console.log();
