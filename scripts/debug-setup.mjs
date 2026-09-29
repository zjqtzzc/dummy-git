#!/usr/bin/env node
/**
 * 给 F5 / Ctrl+F5 准备调试目标：本仓库旁边的 linked worktree `<仓库目录名>-debug`。
 * 由 `.vscode/tasks.json` 的 preLaunchTask 每次自动执行。
 *
 * 为什么是 worktree：当前窗口已经开着本项目，调试窗口再开它会被当成重复打开；
 * worktree 是另一个目录，历史却是同一份，而且每次调试都顺带走一遍 worktree 的路径
 * （`.git` 是文件、git 目录在别处）。
 *
 * 每次都重置到主仓库当前的 HEAD（detached）并清掉未跟踪文件：这是调试用的草稿区，
 * 上一次手动验证留下的提交与改动不该影响这一次。被丢掉的提交 reflog 里还找得回。
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const target = join(dirname(repoRoot), `${basename(repoRoot)}-debug`);

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

const head = git(repoRoot, ["rev-parse", "HEAD"]).trim();

if (existsSync(target)) {
  git(target, ["checkout", "-q", "--detach", "--force", head]);
  git(target, ["clean", "-q", "-fd"]);
  console.log(`已重置：${target} → ${head.slice(0, 7)}`);
} else {
  git(repoRoot, ["worktree", "add", "-q", "--detach", target, head]);
  console.log(`已创建：${target} → ${head.slice(0, 7)}`);
}
