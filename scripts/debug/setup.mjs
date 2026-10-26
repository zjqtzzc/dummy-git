#!/usr/bin/env node
/**
 * 给 F5 准备调试目标：本仓库旁边的独立仓库 `<仓库目录名>-debug`，按「场景」从零建出来。
 *
 *   pnpm debug:setup <场景名>   建这个场景，并记为当前场景（写进 .tmp/debug-scenario）
 *   pnpm debug:setup            重建当前场景——F5 的 preLaunchTask 跑的就是这个
 *
 * 场景是 `scenarios/<场景名>.mjs`，导出 `build(g)`，把空仓库推到要测的状态（停在冲突中、
 * 有个分叉的上游……）。每次都删掉重建：手测往往把现场用掉（解决了冲突、pop 了 stash），
 * 再按一次 F5 就回到同一个干净的现场。
 *
 * 为什么是独立仓库而不是本项目的 worktree：worktree 与主仓库共用 refs/heads、refs/stash
 * 和配置，调试窗口里删分支、drop stash 动的是真实仓库。
 *
 * 身份与时间用本机的真实配置，不像 fixture.mjs 那样固定：手测要的是贴近日常使用的现场，
 * 「User: Me」「最近 24 小时」这类过滤在固定身份与 2020 年的时间下什么也匹配不到。
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(dirname(here));
// 调试仓库放在本仓库**外面**：放进 `.tmp/` 的话，它的 `.git` 一旦不在（重建到一半、建失败），
// 调试窗口里的 git 命令会往上找到本仓库，Reset、Drop 这些就动到了真代码。
const target = join(dirname(repoRoot), `${basename(repoRoot)}-debug`);
const currentFile = join(repoRoot, ".tmp", "debug-scenario");
const scenarioDir = join(here, "scenarios");

const scenarios = readdirSync(scenarioDir)
  .filter((file) => file.endsWith(".mjs"))
  .map((file) => file.slice(0, -".mjs".length));

const name =
  process.argv[2] ??
  (existsSync(currentFile) ? readFileSync(currentFile, "utf8").trim() : undefined);
if (name === undefined || !scenarios.includes(name)) {
  console.error(name === undefined ? "还没有选过场景。" : `没有场景「${name}」。`);
  console.error(`先跑 pnpm debug:setup <场景名>，可选：${scenarios.join("、")}`);
  process.exit(1);
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

// 这个目录以前是本项目的 linked worktree（`.git` 是文件）。直接删目录会在主仓库留下
// 一条失效的 worktree 记录，所以交给 git 摘。
const dotGit = join(target, ".git");
if (existsSync(dotGit) && statSync(dotGit).isFile()) {
  git(repoRoot, ["worktree", "remove", "--force", target]);
  console.log(`已摘掉旧的 worktree：${target}`);
}

// 清空目录里的东西，不删目录本身：调试窗口开着时，它对工作区根目录的文件监听挂在这个目录上，
// 目录一删监听就没了（Linux 的 inotify 不会跟到新建的同名目录上），面板从此不刷新，像扩展的 bug。
mkdirSync(target, { recursive: true });
for (const entry of readdirSync(target)) {
  rmSync(join(target, entry), { recursive: true, force: true });
}
git(target, ["init", "-q"]);
git(target, ["symbolic-ref", "HEAD", "refs/heads/main"]);

/** 交给场景的工具。场景只用这几样，不直接碰路径与进程。 */
const g = {
  /** 写一个文件；所在目录不存在时先建出来。 */
  write(file, content) {
    mkdirSync(dirname(join(target, file)), { recursive: true });
    writeFileSync(join(target, file), content, "utf8");
  },
  /** 只删磁盘上的文件，不碰暂存区（造「改名后又删掉新路径」这类状态）。 */
  remove(file) {
    rmSync(join(target, file));
  },
  git(...args) {
    return git(target, args);
  },
  /** 从标准输入喂数据的命令（比如用 fast-import 一次造上万个提交）。 */
  gitInput(input, ...args) {
    return execFileSync("git", args, { cwd: target, input, encoding: "utf8" });
  },
  /** 预期失败的命令（比如造冲突的 stash pop）：吞掉非零退出码。 */
  gitMayFail(...args) {
    try {
      git(target, args);
    } catch {
      /* 预期内 */
    }
  },
};

const scenario = await import(pathToFileURL(join(scenarioDir, `${name}.mjs`)).href);
scenario.build(g);
mkdirSync(dirname(currentFile), { recursive: true });
writeFileSync(currentFile, `${name}\n`);

// 打出现场实际到了什么状态，顺带核对场景建对了没有。
console.log(`场景「${name}」已建好：${target}\n`);
console.log(git(target, ["status"]).trimEnd());
const stashes = git(target, ["stash", "list"]).trimEnd();
if (stashes !== "") console.log(`\nstash:\n${stashes}`);
