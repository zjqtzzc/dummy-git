#!/usr/bin/env node
/**
 * 把「真实 git 操作 → .git 里哪些文件变了 → 映射成哪几个域」跑给人看。
 *
 *   node scripts/demo-watch.mjs
 *
 * **这不是测试**——分类的正确性由 `core/__tests__/classify.test.ts` 与
 * `repository.test.ts` 断言。这个脚本存在是为了测试给不了的东西：
 * **真实操作实际碰了哪些文件**。分类表是照着文档写的，这里验的是
 * 「文档说 commit 会碰 HEAD/index/refs，git 实际也这么干吗」。
 *
 * 做法不是模拟路径，是每次操作前后各扫一遍 `.git`，取差集。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { build } from "esbuild";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const OUT = mkdtempSync(join(tmpdir(), "demo-watch-"));

const BOLD = "\u001b[1m";
const DIM = "\u001b[2m";
const CYAN = "\u001b[36m";
const YELLOW = "\u001b[33m";
const OFF = "\u001b[0m";

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

const { classifyGitPath } = await load("packages/extension/src/core/classify.ts", "classify");

const repo = mkdtempSync(join(tmpdir(), "watch-repo-"));
const git = (args, opts = {}) =>
  execFileSync("git", args, { cwd: repo, stdio: "pipe", encoding: "utf8", ...opts });

git(["init", "-q", "-b", "main"]);
git(["config", "user.email", "a@b.c"]);
git(["config", "user.name", "a"]);

/** 递归列出 .git 下所有文件 → Map<相对路径, mtimeMs+size>。 */
function snapshotGitDir() {
  const gitDir = join(repo, ".git");
  const out = new Map();
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full, { throwIfNoEntry: false });
      if (st === undefined) continue;
      if (st.isDirectory()) walk(full);
      else out.set(relative(gitDir, full).split(sep).join("/"), `${st.mtimeMs}:${st.size}`);
    }
  };
  walk(gitDir);
  return out;
}

/** 跑一个操作，返回它实际碰过的 .git 相对路径。 */
function pathsTouchedBy(label, action) {
  const before = snapshotGitDir();
  action();
  const after = snapshotGitDir();
  const touched = [];
  for (const [path, stamp] of after) {
    if (before.get(path) !== stamp) touched.push(path);
  }
  for (const path of before.keys()) {
    if (!after.has(path)) touched.push(path);
  }
  return { label, touched: touched.sort() };
}

function report({ label, touched }) {
  console.log(`\n${BOLD}${CYAN}━━ ${label} ━━${OFF}`);

  const domains = new Set();
  const kept = [];
  const dropped = [];
  for (const path of touched) {
    const d = classifyGitPath(path);
    if (d.length === 0) dropped.push(path);
    else {
      kept.push([path, d]);
      for (const one of d) domains.add(one);
    }
  }

  console.log(`\n  ${BOLD}git 实际碰过 ${touched.length} 个文件${OFF}`);
  for (const [path, d] of kept) {
    console.log(`    ${YELLOW}★${OFF} ${path.padEnd(34)} → ${d.join(", ")}`);
  }
  if (dropped.length > 0) {
    const shown = dropped.slice(0, 4).join("  ");
    const more = dropped.length > 4 ? `  ${DIM}…还有 ${dropped.length - 4} 个${OFF}` : "";
    console.log(`    ${DIM}· 丢弃 ${dropped.length} 个：${shown}${more}${OFF}`);
  }
  console.log(`\n  ${BOLD}合并后的域 = { ${[...domains].join(", ") || "（无）"} }${OFF}`);
  return domains;
}

console.log(`${BOLD}真实 git 操作 → .git 实际变动 → 域${OFF}`);
console.log(`${DIM}仓库：${repo}${OFF}`);
console.log("═".repeat(72));

// ① 提交
writeFileSync(join(repo, "a.txt"), "one\n");
git(["add", "-A"]);
report(pathsTouchedBy("① commit —— 应得 refs + worktree", () => git(["commit", "-qm", "first"])));

// ② 只改工作区文件：分域最主要的收益
report(
  pathsTouchedBy("② 只改工作区文件 —— .git 里什么都不该变", () => {
    writeFileSync(join(repo, "a.txt"), "changed\n");
  }),
);
console.log(
  `  ${DIM}↑ 工作区改动不碰 .git，它走另一条通道（Repository.notifyWorkspacePath）。${OFF}\n` +
    `  ${DIM}  这正是分域的主要收益：保存一次文件不该重算整张提交图。${OFF}`,
);

// ③ 暂存：只该给 worktree，绝不给 refs
report(pathsTouchedBy("③ git add —— 只该动 index，不该给 refs", () => git(["add", "-A"])));
git(["commit", "-qm", "second"]);

// ④ stash
report(
  pathsTouchedBy("④ git stash —— 应含 stash 域", () => {
    writeFileSync(join(repo, "a.txt"), "dirty\n");
    git(["stash", "-q"]);
  }),
);

// ⑤ merge 冲突 → operation
git(["checkout", "-q", "-b", "side"]);
writeFileSync(join(repo, "a.txt"), "side\n");
git(["add", "-A"]);
git(["commit", "-qm", "side"]);
git(["checkout", "-q", "main"]);
writeFileSync(join(repo, "a.txt"), "main\n");
git(["add", "-A"]);
git(["commit", "-qm", "main side"]);
report(
  pathsTouchedBy("⑤ merge 冲突 —— 应含 operation 域", () => {
    try {
      git(["merge", "side"]);
    } catch {
      /* 冲突是预期的 */
    }
  }),
);
git(["merge", "--abort"]);

// ⑥ 多提交 cherry-pick → sequencer（验收标准 4c）
git(["checkout", "-q", "-b", "picks", "main"]);
for (const n of [1, 2, 3]) {
  writeFileSync(join(repo, `p${n}.txt`), `${n}\n`);
  git(["add", "-A"]);
  git(["commit", "-qm", `pick ${n}`]);
}
git(["checkout", "-q", "main"]);
writeFileSync(join(repo, "p2.txt"), "conflict\n");
git(["add", "-A"]);
git(["commit", "-qm", "will conflict"]);
const seq = report(
  pathsTouchedBy("⑥ 多提交 cherry-pick 中断 —— 验 sequencer/**（验收标准 4c）", () => {
    try {
      git(["cherry-pick", "picks~2..picks"]);
    } catch {
      /* 冲突是预期的 */
    }
  }),
);
console.log(
  seq.has("operation")
    ? `  ${DIM}↑ sequencer/ 被认出来了。漏了它，界面看不出「正在 cherry-pick，还剩几个」。${OFF}`
    : `  ${YELLOW}⚠ operation 域没被触发——sequencer 规则可能漏了${OFF}`,
);

console.log(`\n${"═".repeat(72)}`);
console.log(
  `${DIM}分类的正确性由测试断言；这里验的是「git 实际碰的文件」与分类表对不对得上。${OFF}`,
);
