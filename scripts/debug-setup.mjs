#!/usr/bin/env node
/**
 * 给 F5 调试准备一个目标目录：本仓库的一个 linked worktree，放在仓库旁边的
 * `<仓库目录名>-debug`。
 *
 * 为什么不直接让调试窗口打开本项目：当前窗口已经开着它，VS Code 把第二个窗口当成
 * 重复打开，不会正常出现。换成 worktree 是另一个目录，历史却还是本项目的历史，
 * 而且每次调试都顺带走一遍 worktree 的路径（`.git` 是文件、git 目录在别处）。
 *
 * detached 在当前提交上，不建分支。已存在就什么都不做。
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const target = join(dirname(repoRoot), `${basename(repoRoot)}-debug`);

if (existsSync(target)) {
  console.log(`已存在：${target}`);
} else {
  execFileSync("git", ["worktree", "add", "--detach", target, "HEAD"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  console.log(`已创建：${target}`);
}
