#!/usr/bin/env node
/**
 * 把 git 失败的原始 stderr 和分类结果并排打出来看。
 *
 *   node scripts/demo-errors.mjs              跑全部
 *   node scripts/demo-errors.mjs lock         只跑名字含 lock 的
 *
 * **这不是测试**——正确性由 `git/__tests__/failure.test.ts` 断言，
 * 这个脚本不重复那件事。它存在的理由是测试给不了的东西：
 * 把原始 stderr **带行号**摆在人眼前，用于调试或理解分类依据。
 *
 * 每条打三段：
 *   ① 实际执行的 git 命令（可以直接复制到终端重跑）
 *   ② 原始 stderr，**带行号**
 *   ③ `classifyError()` 的结果 / `run()` 的行为
 *
 * ② 带行号是有意的：`RepositoryIsLocked` 保留在闭集里的全部理由，就是
 * 「第 1 行恰好是最没用的一行，有用的在第 3 行」——不标行号就看不出这件事。
 *
 * 失败场景**就地造**（临时仓库 + `touch` 一个锁文件），不进 `fixture.mjs`：
 * 那个脚本的职责是造有历史形态的仓库给 parser 用，性质不同。
 */
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const GIT_DIR = join(ROOT, "packages/extension/src/git");

const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const OFF = "\x1b[0m";

/** TS 源码不能直接 import，用 esbuild 打包到临时目录再加载。 */
async function load(outDir, name) {
  const outfile = join(outDir, `${name}.mjs`);
  await build({
    entryPoints: [join(GIT_DIR, `${name}.ts`)],
    bundle: true,
    format: "esm",
    platform: "node",
    external: ["node:*"],
    outfile,
    logLevel: "error",
  });
  return import(outfile);
}

const AUTHOR_ENV = {
  GIT_AUTHOR_NAME: "demo",
  GIT_AUTHOR_EMAIL: "demo@example.com",
  GIT_COMMITTER_NAME: "demo",
  GIT_COMMITTER_EMAIL: "demo@example.com",
};

/** 建一个最小仓库：一次提交，外加一个往 stderr 打 `error:` 却退出 0 的 hook。 */
function makeRepo() {
  const repo = mkdtempSync(join(tmpdir(), "dummy-git-errors-"));
  const g = (...args) =>
    execFileSync("git", args, {
      cwd: repo,
      stdio: "ignore",
      env: { ...process.env, ...AUTHOR_ENV },
    });
  g("init", "-q", "-b", "main");
  writeFileSync(join(repo, "f.txt"), "hi\n");
  g("add", "-A");
  g("commit", "-qm", "init");

  // git hook 的输出**全部走 stderr**。husky / lint-staged 的提示天天出现在那里。
  // 靠「stderr 里有 error: 就算失败」的实现，每次带 hook 的提交都会被误判。
  const hooks = join(repo, ".hooks");
  mkdirSync(hooks);
  writeFileSync(
    join(hooks, "pre-commit"),
    '#!/bin/sh\necho "error: hook 的噪声，不是失败" >&2\nexit 0\n',
  );
  chmodSync(join(hooks, "pre-commit"), 0o755);
  return { repo, hooks };
}

/**
 * 临时放一个锁文件，跑完就删。
 *
 * **必须 `await fn()` 而不是 `return fn()`**：后者会在异步任务还没跑之前就走到
 * `finally` 把锁删掉，于是命令根本没撞上锁——现象是「demo 全绿，但什么都没验到」。
 * 这是本脚本写出来时踩的第一个坑。
 */
async function withLock(repo, relPath, fn) {
  const lock = join(repo, relPath);
  closeSync(openSync(lock, "w"));
  try {
    return await fn();
  } finally {
    rmSync(lock, { force: true });
  }
}

function cases({ repo, hooks }) {
  return [
    {
      name: "index 锁被占用",
      why: "M4 闭集里 RepositoryIsLocked 的主场景。注意第 1 行与第 3 行的落差。",
      args: ["commit", "--allow-empty", "-m", "x"],
      wrap: (fn) => withLock(repo, ".git/index.lock", fn),
    },
    {
      name: "ref 锁被占用",
      why: "git 给它追加了**完全相同**的解释段落，所以同一个码覆盖两者是对的。",
      args: ["commit", "--allow-empty", "-m", "x"],
      wrap: (fn) => withLock(repo, ".git/refs/heads/main.lock", fn),
    },
    {
      name: "不是 git 仓库",
      why: "闭集里唯一带来真实行为差异的码——M6 据此把仓库置为 Disposed。",
      args: ["status"],
      cwd: tmpdir(),
    },
    {
      name: "认不出：分支不存在",
      why: "反例。证明它不乱认，和证明它认得出同样重要。",
      args: ["checkout", "nosuchbranch"],
    },
    {
      name: "认不出：参数写错",
      why: "反例。退出码同样是 128，但不该被认成任何一个码。",
      args: ["log", "--no-such-flag"],
    },
    {
      name: "exit 0 但 stderr 含 error:",
      why: "hook 的噪声。若靠 stderr 判断失败，每次带 hook 的提交都会被误判。",
      args: ["-c", `core.hooksPath=${hooks}`, "commit", "--allow-empty", "-m", "y"],
    },
    {
      name: "exit 非 0 但不是失败",
      why: "`diff --quiet` 的 1 是「有差异」。这类命令该用 exec() 而不是 run()。",
      args: ["diff", "--quiet"],
      // 先制造一处差异，否则这条会返回 0，演示不出「非零退出码不是失败」。
      before: () => writeFileSync(join(repo, "f.txt"), "changed\n"),
      useExec: true,
    },
  ];
}

/** 打印 stderr，带行号。空行也占一行——`RepositoryIsLocked` 的第 2 行正是空行。 */
function printStderr(stderr) {
  if (stderr === "") {
    console.log(`  ${DIM}(空)${OFF}`);
    return;
  }
  const lines = stderr.replace(/\n$/, "").split("\n");
  for (const [i, line] of lines.entries()) {
    const n = String(i + 1).padStart(2);
    console.log(`  ${DIM}${n} │${OFF} ${line === "" ? `${DIM}⏎${OFF}` : line}`);
  }
}

async function main() {
  const filter = process.argv[2];
  const outDir = mkdtempSync(join(tmpdir(), "dummy-git-demo-"));
  const { repo, hooks } = makeRepo();

  try {
    const { GitCli } = await load(outDir, "cli");
    const { classifyError, run, GitFailureError } = await load(outDir, "failure");
    const cli = new GitCli("git");

    for (const c of cases({ repo, hooks })) {
      if (filter !== undefined && !c.name.includes(filter)) continue;
      const cwd = c.cwd ?? repo;

      console.log(`\n${BOLD}${CYAN}━━ ${c.name} ━━${OFF}`);
      console.log(`${DIM}${c.why}${OFF}`);
      console.log(
        `\n${BOLD}命令${OFF}\n  ${YELLOW}git ${c.args.join(" ")}${OFF}  ${DIM}(cwd: ${cwd})${OFF}`,
      );

      const invoke = async () => {
        if (c.useExec === true) {
          const r = await cli.exec(c.args, { cwd });
          return { stderr: r.stderr, outcome: `${GREEN}exec() 返回 exitCode=${r.exitCode}${OFF}` };
        }
        try {
          const r = await run(cli, c.args, { cwd });
          return {
            stderr: r.stderr,
            outcome: `${GREEN}run() 正常返回，exitCode=${r.exitCode}${OFF}`,
          };
        } catch (error) {
          if (error instanceof GitFailureError) {
            const code = error.code ?? `${DIM}undefined（认不出，属常态）${OFF}`;
            return {
              stderr: error.stderr,
              outcome: `${RED}run() 抛 GitFailureError${OFF}  exitCode=${error.exitCode}  code=${code}`,
            };
          }
          throw error;
        }
      };

      c.before?.();
      const { stderr, outcome } = await (c.wrap ?? ((fn) => fn()))(invoke);

      console.log(`\n${BOLD}原始 stderr${OFF}`);
      printStderr(stderr);
      console.log(`\n${BOLD}分类${OFF}`);
      console.log(`  classifyError → ${classifyError(stderr) ?? `${DIM}undefined${OFF}`}`);
      console.log(`  ${outcome}`);
    }
  } finally {
    rmSync(outDir, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
}

await main();
