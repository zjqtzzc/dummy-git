/**
 * M6 第 1 步：测 watcher 事件的时序特征。
 *
 * 回答两个问题（`design/M6-repository.md` §7.6 的测量项 1 与 3）：
 *   1. 我们的写命令**返回之后**，文件事件还要多久才到？
 *   2. 一次 `commit` 滤掉噪声后，还剩几个有效事件？
 *
 * 这两个数决定防抖窗口定多少（设计稿起始值 150ms）。
 *
 * ## ⚠️ 这里测到的是下限，不是全貌
 *
 * 真实链路有两段：
 *
 *     git 写文件 ──①OS 送事件──> node fs.watch ──②VSCode 批处理──> 扩展
 *
 * `workspace.createFileSystemWatcher` 是 VSCode 的 API，只在扩展宿主里存在，
 * 纯 node 拿不到。所以本脚本测的是 ①，②那段 VSCode 有自己的合并逻辑、会再加一笔。
 *
 * 结论怎么用：① 若已经很大（比如 100ms），150ms 的窗口当场就不成立；
 * ① 若很小，说明预算大头在 ②，要等 M7 能起扩展宿主时才补得全。
 *
 * ## 为什么跑我们自己的命令，而不是直接 execFileSync("git", ...)
 *
 * 要测的是「**我们的** `run()` 返回」到「事件到达」的间隔。
 * 直接调 git 会漏掉命令层与队列的开销，测出来的数偏小。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, watch, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { build } from "esbuild";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const OUT = mkdtempSync(join(tmpdir(), "demo-watch-"));

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

const cli = new GitCli("git");

function makeRepo() {
  const repo = mkdtempSync(join(tmpdir(), "watch-repo-"));
  const git = (args) => execFileSync("git", args, { cwd: repo, stdio: "pipe" });
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "a@b.c"]);
  git(["config", "user.name", "a"]);
  writeFileSync(join(repo, "f1"), "a\n");
  git(["add", "-A"]);
  git(["commit", "-qm", "init"]);
  return repo;
}

/**
 * §9 的噪声规则。这里只实现「挡噪声」那一半——本步不做域映射，
 * 那是第 3 步的事。现在只需要知道**滤完还剩几个**。
 */
function isNoise(relPath) {
  return (
    relPath.startsWith(`objects${sep}`) ||
    relPath.startsWith(`lfs${sep}`) ||
    relPath.startsWith(`hooks${sep}`) ||
    relPath.startsWith(`info${sep}`) ||
    relPath.endsWith(".lock")
  );
}

const repo = makeRepo();
const gitDir = join(repo, ".git");

/** 每条记录：事件到达时刻（相对 t0）+ 路径。t0 在写命令返回时确定。 */
const events = [];
let t0 = Number.NaN;

let watcher;
try {
  watcher = watch(gitDir, { recursive: true }, (_type, filename) => {
    if (filename === null) return;
    events.push({ at: performance.now(), path: filename });
  });
} catch (err) {
  console.error("fs.watch 递归监听不可用：", err.message);
  console.error(`（Linux 上需要 Node 20+；本机 ${process.version}）`);
  process.exit(1);
}

// 让 inotify 注册完成再动手，否则头几个事件可能收不到。
await new Promise((r) => setTimeout(r, 200));

console.log("① 一次 commit：从「我们的 run() 返回」到「事件到达」");
console.log("─".repeat(64));

writeFileSync(join(repo, "f1"), "changed\n");

const queue = new CommandQueue();
const started = performance.now();
await runCommand(queue, cli, commit, repo, "测量用提交", ["f1"]);
t0 = performance.now();

console.log(`  命令本身耗时：${(t0 - started).toFixed(0)} ms`);

// 等足够久，把这一轮事件收全。500ms 远大于预期的到达延迟。
await new Promise((r) => setTimeout(r, 500));
watcher.close();

const after = events.filter((e) => e.at >= t0);
const before = events.filter((e) => e.at < t0);
const effective = events.filter((e) => !isNoise(e.path));
const effectiveAfter = effective.filter((e) => e.at >= t0);

console.log(`  命令返回**前**已到达：${before.length} 个事件`);
console.log(`  命令返回**后**才到达：${after.length} 个事件`);
if (after.length > 0) {
  const delays = after.map((e) => e.at - t0);
  console.log(
    `    首个 +${Math.min(...delays).toFixed(1)} ms  末个 +${Math.max(...delays).toFixed(1)} ms`,
  );
}
console.log();

console.log("② 事件构成：滤噪前 vs 滤噪后");
console.log("─".repeat(64));
console.log(`  原始事件总数：${events.length}`);
console.log(`  滤掉噪声后：  ${effective.length}（其中命令返回后到达 ${effectiveAfter.length}）`);
console.log();
const uniq = new Map();
for (const e of events) {
  const key = e.path;
  const rec = uniq.get(key) ?? { n: 0, first: e.at, noise: isNoise(key) };
  rec.n += 1;
  uniq.set(key, rec);
}
console.log("  按路径（★ = 有效，· = 噪声）：");
for (const [path, rec] of [...uniq].sort((a, b) => a[1].first - b[1].first)) {
  const mark = rec.noise ? "·" : "★";
  const when = Number.isNaN(t0)
    ? ""
    : `  ${(rec.first - t0 >= 0 ? "+" : "") + (rec.first - t0).toFixed(1)} ms`;
  console.log(`    ${mark} ${path}  ×${rec.n}${when}`);
}
console.log();

console.log("③ 结论");
console.log("─".repeat(64));
if (after.length === 0) {
  console.log("  ⚠️ 全部事件在命令返回**前**就已到达。");
  console.log("     → 「命令返回时事件还没到」这个担心不成立，");
  console.log("       设计稿 §7.5 那个「提前结算」方案在这一层是可行的。");
} else {
  const maxDelay = Math.max(...after.map((e) => e.at - t0));
  console.log(`  命令返回后最长还要等 ${maxDelay.toFixed(1)} ms 事件才到齐。`);
  console.log(`  → 防抖窗口至少要 > ${maxDelay.toFixed(0)} ms，否则会把一次 commit 拆成多次通知。`);
}
console.log();
console.log("  ⚠️ 以上只是链路的第 ① 段（OS → node）。");
console.log("     VSCode 自己的批处理层（第 ② 段）测不到，要等 M7 能起扩展宿主。");
