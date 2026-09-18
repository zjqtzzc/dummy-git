#!/usr/bin/env node
/**
 * 把命令层的行为跑给人看。随 M5 逐步长大。
 *
 *   node scripts/demo-commands.mjs
 *
 * **这不是测试**：没有断言，不会失败，不进 `pnpm check`。
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const OUT = mkdtempSync(join(tmpdir(), "demo-cmd-"));

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
const { getRepositoryRoot } = await load("packages/extension/src/git/commands/root.ts", "root");
const { getStatus } = await load("packages/extension/src/git/commands/status.ts", "status");
const { commit } = await load("packages/extension/src/git/commands/commit.ts", "commit");

const cli = new GitCli("git");

// ── 造场景 ────────────────────────────────────────────────────────
const base = mkdtempSync(join(tmpdir(), "demo-repo-"));
const repo = join(base, "main");
const git = (cwd, args) => execFileSync("git", args, { cwd, stdio: "pipe" });
mkdirSync(repo);
git(repo, ["init", "-q", "-b", "main"]);
git(repo, ["config", "user.email", "a@b.c"]);
git(repo, ["config", "user.name", "a"]);
mkdirSync(join(repo, "src", "deep"), { recursive: true });
writeFileSync(join(repo, "src", "deep", "f.txt"), "x\n");
git(repo, ["add", "-A"]);
git(repo, ["commit", "-qm", "init"]);
git(repo, ["worktree", "add", "-q", join(base, "wt"), "-b", "wtbranch"]);
const plain = join(base, "plain");
mkdirSync(plain);

const cases = [
  ["仓库根目录", repo],
  ["仓库的深层子目录（./.git 不存在）", join(repo, "src", "deep")],
  ["linked worktree（.git 是文件不是目录）", join(base, "wt")],
  ["根本不是仓库", plain],
];

console.log(`\n锁策略：${getRepositoryRoot.lock}\n`);
console.log("═".repeat(72));

for (const [label, path] of cases) {
  const dotGit = join(path, ".git");
  const hint = existsSync(dotGit)
    ? `./.git 存在（${execFileSync("stat", ["-c", "%F", dotGit]).toString().trim()}）`
    : "./.git 不存在";
  console.log(`\n▸ ${label}`);
  console.log(`  输入   ${path}`);
  console.log(`  朴素判据  ${hint}`);
  try {
    const root = await getRepositoryRoot.execute(cli, path);
    console.log(`  结果   ✅ ${root}`);
  } catch (err) {
    console.log(`  结果   ❌ ${err.name}  code=${err.code ?? "(认不出)"}`);
    console.log(`         ${err.message.split("\n")[0]}`);
  }
}
console.log();

// ── getStatus：第一条要解析输出的命令 ──────────────────────────────
console.log("═".repeat(72));
console.log(`\n锁策略：${getStatus.lock}\n`);

writeFileSync(join(repo, "src", "deep", "f.txt"), "changed\n"); // 已跟踪 → 改动
writeFileSync(join(repo, "新建 文件.txt"), "untracked\n"); // 未跟踪 + 中文 + 空格
mkdirSync(join(repo, "staged"), { recursive: true });
writeFileSync(join(repo, "staged", "s.txt"), "staged\n");
git(repo, ["add", "staged/s.txt"]); // 已暂存

console.log("▸ getStatus 的解析结果");
for (const c of await getStatus.execute(cli, repo)) {
  const detail =
    c.kind === "tracked"
      ? `index=${c.index} worktree=${c.worktree}`
      : c.kind === "conflict"
        ? c.conflict
        : "";
  console.log(`  ${c.kind.padEnd(10)} ${JSON.stringify(c.path).padEnd(22)} ${detail}`);
}

console.log("\n▸ 实际执行的命令（可复制到终端重跑）");
console.log(`  GIT_OPTIONAL_LOCKS=0 git status --porcelain=v2 -z -uall`);
console.log(`  ↑ 这个环境变量的欠条跨了 M2→M3→M5 三个里程碑，在 status.ts 兑现`);
console.log();

// ── commit：第一条写命令 ──────────────────────────────────────────
console.log("═".repeat(72));
console.log(`\n锁策略：${commit.lock}\n`);

// 关键场景：另有一个文件已被 git add 进暂存区，但**不在**本次勾选范围内。
// 没有 --only 的话它会被一起提交进去（旧仓库 e004b7c）。
git(repo, ["add", "新建 文件.txt"]);
console.log("▸ 提交前的工作区");
for (const c of await getStatus.execute(cli, repo)) {
  console.log(`  ${c.kind.padEnd(10)} ${JSON.stringify(c.path)}`);
}

const picked = ["src/deep/f.txt"];
console.log(`\n▸ 只勾选 ${JSON.stringify(picked)} 提交`);
await commit.execute(cli, repo, "第一条写命令\n\n消息含换行与中文。\n", picked);

const head = execFileSync("git", ["log", "-1", "--name-only", "--format=%s"], { cwd: repo })
  .toString()
  .trim()
  .split("\n");
console.log(`  提交标题   ${head[0]}`);
console.log(`  实际提交了 ${head.slice(1).filter(Boolean).join(", ")}`);

console.log("\n▸ 提交后：被 add 过但没勾选的文件应当还在暂存区");
for (const c of await getStatus.execute(cli, repo)) {
  const d = c.kind === "tracked" ? `index=${c.index} worktree=${c.worktree}` : "";
  console.log(`  ${c.kind.padEnd(10)} ${JSON.stringify(c.path).padEnd(22)} ${d}`);
}
console.log();
