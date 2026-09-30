#!/usr/bin/env node
/**
 * 用**真的 git 子进程**把「队列到底解决了什么」跑给人看。
 *
 *   node scripts/demo-race.mjs
 *
 * **这不是测试**——同样的两个场景已由
 * `git/commands/__tests__/commit.test.ts`「真 git：队列决定「改动会不会丢」」断言。
 * 这个脚本留着是因为它打印**真实测量的时长**（418ms / 822ms 这类数字），
 * 那是叙述价值，断言给不了。
 *
 * 两组对照，同一个场景跑两遍：
 *   ① 不过队列，直接并发 → 撞 .git/index.lock，一条提交的内容**直接丢失**
 *   ② 过队列 → 依次排队，两条都成功
 *
 * 用 pre-commit 钩子 sleep 0.4s 把竞争窗口撑开，让结果稳定可复现——
 * 不撑开的话 commit 只要十几毫秒，撞不撞全看运气。
 */
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const OUT = mkdtempSync(join(tmpdir(), "demo-race-"));

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

const { GitCli } = await load("packages/extension/src/git/cli.ts", "cli");
const { CommandQueue } = await load("packages/extension/src/core/operation.ts", "operation");
const { runCommand } = await load("packages/extension/src/core/executor.ts", "executor");
const { commit } = await load("packages/extension/src/git/commands/commit.ts", "commit");
const { getStatus } = await load("packages/extension/src/git/commands/status.ts", "status");
const { getSkeleton, getCommitDetails } = await load(
  "packages/extension/src/git/commands/log.ts",
  "log",
);

const cli = new GitCli("git");

function makeRepo() {
  const repo = mkdtempSync(join(tmpdir(), "race-repo-"));
  const git = (args) => execFileSync("git", args, { cwd: repo, stdio: "pipe" });
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "a@b.c"]);
  git(["config", "user.name", "a"]);
  writeFileSync(join(repo, "f1"), "a\n");
  writeFileSync(join(repo, "f2"), "b\n");
  git(["add", "-A"]);
  git(["commit", "-qm", "init"]);
  // 把竞争窗口撑开到 400ms，让结果稳定
  mkdirSync(join(repo, ".git", "hooks"), { recursive: true });
  const hook = join(repo, ".git", "hooks", "pre-commit");
  writeFileSync(hook, "#!/bin/sh\nsleep 0.4\n");
  chmodSync(hook, 0o755);
  writeFileSync(join(repo, "f1"), "a\nchanged\n");
  writeFileSync(join(repo, "f2"), "b\nchanged\n");
  return repo;
}

function report(repo, t0, results) {
  for (const [i, r] of results.entries()) {
    const tag = ["A", "B"][i];
    if (r.status === "fulfilled") console.log(`  [${tag}] ✅ 成功`);
    else console.log(`  [${tag}] ❌ ${r.reason.name}  code=${r.reason.code ?? "(认不出)"}`);
  }
  const count = execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: repo })
    .toString()
    .trim();
  const subjects = execFileSync("git", ["log", "--format=%s"], { cwd: repo })
    .toString()
    .trim()
    .split("\n");
  console.log(`  历史：${count} 个提交  [${subjects.join(" ← ")}]`);
  console.log(`  总耗时：${Date.now() - t0} ms`);
}

// ── ① 不过队列 ────────────────────────────────────────────────────
{
  const repo = makeRepo();
  console.log("\n① 不过队列：两条 commit 直接并发");
  console.log("─".repeat(68));
  const t0 = Date.now();
  const results = await Promise.allSettled([
    commit.execute(cli, repo, "提交 A\n", ["f1"], []),
    commit.execute(cli, repo, "提交 B\n", ["f2"], []),
  ]);
  report(repo, t0, results);
  console.log("  → 一条失败，它要提交的内容**没有进入历史**");
}

// ── ② 过队列 ──────────────────────────────────────────────────────
{
  const repo = makeRepo();
  console.log("\n② 过队列：同样两条 commit");
  console.log("─".repeat(68));
  const queue = new CommandQueue();
  const t0 = Date.now();
  const results = await Promise.allSettled([
    runCommand(queue, cli, commit, repo, "提交 A\n", ["f1"], []),
    runCommand(queue, cli, commit, repo, "提交 B\n", ["f2"], []),
  ]);
  report(repo, t0, results);
  console.log("  → 两条都进了历史。耗时约为①的两倍，因为真的排了队");
}

// ── ③ 读命令不受影响 ──────────────────────────────────────────────
{
  const repo = makeRepo();
  console.log("\n③ 读命令：同一个队列上并发三条 getStatus");
  console.log("─".repeat(68));
  const queue = new CommandQueue();
  const t0 = Date.now();
  const marks = [];
  await Promise.all(
    [1, 2, 3].map(async (n) => {
      const started = Date.now() - t0;
      await runCommand(queue, cli, getStatus, repo);
      marks.push(`读${n} 开始于 ${started}ms`);
    }),
  );
  console.log(`  ${marks.join("  |  ")}`);
  console.log(`  总耗时：${Date.now() - t0} ms`);
  console.log("  → 全部立刻开始，读命令连队都不排");
}
console.log();

// ── ④ 不同仓库的写命令互不等待（门禁 3，此前从未验过）────────────────
{
  const repoA = makeRepo();
  const repoB = makeRepo();
  console.log("\n④ 两个仓库各一条写命令：锁是每仓库一把，不该互相等");
  console.log("─".repeat(68));
  const qA = new CommandQueue();
  const qB = new CommandQueue();
  const t0 = Date.now();
  await Promise.all([
    runCommand(qA, cli, commit, repoA, "仓库A\n", ["f1"], []),
    runCommand(qB, cli, commit, repoB, "仓库B\n", ["f1"], []),
  ]);
  const total = Date.now() - t0;
  console.log(`  总耗时 ${total} ms（单条约 400ms —— 排队的话应接近 800ms）`);
  console.log(`  → ${total < 700 ? "并行，互不等待 ✅" : "串行了 ❌"}`);
}

// ── ⑤ getLog：两步取数 ────────────────────────────────────────────
{
  const repo = makeRepo();
  await runCommand(new CommandQueue(), cli, commit, repo, "提交 1\n", ["f1"], []);
  console.log("\n⑤ 取数模型 B：全量骨架 → 按 hash 取详情");
  console.log("─".repeat(68));
  const q = new CommandQueue();
  const skeleton = await runCommand(q, cli, getSkeleton, repo);
  console.log(`  骨架 ${skeleton.length} 条，每条只有 hash/parents/at`);
  console.log(`    ${JSON.stringify(skeleton[0])}`);
  const details = await runCommand(q, cli, getCommitDetails, repo, [skeleton[0].hash]);
  const d = details[0];
  console.log(
    `  详情只取了 1 条：${d.author.name} <${d.author.email}> ${JSON.stringify(d.message)}`,
  );
  console.log(`  → 骨架跑遍全历史，详情只取当前要显示的那几十条`);
}
console.log();
