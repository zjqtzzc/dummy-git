import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GitCli } from "../git/cli.js";

/**
 * 测试公用设施。
 *
 * 两类仓库，用途不同，不要混：
 * - **fixture 仓库**：`vitest.globalSetup.ts` 整轮建一次，**只读**。
 *   给 parser 这类「喂已知历史、看解析结果」的测试用。
 * - **临时仓库**：`makeTempRepo()` 每次现建，**可写**。
 *   给「要改动仓库才能验」的测试用（提交、锁冲突、排队）。
 */

/** 仓库根目录。本文件在 `packages/extension/src/__tests__/`，往上四层。 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

/** 与 `vitest.globalSetup.ts` 算出同一个位置——不靠跨进程传递。 */
const fixturesRoot = join(repoRoot, ".fixtures-test");

/** fixture 仓库。名字与 `scripts/fixture.mjs` 里建的一一对应。 */
export const fixtures = {
  /** 历史形态齐全（根提交 / merge / 中文名 / 多行消息 / 奇异消息）+ 工作区有改动 */
  base: join(fixturesRoot, "base"),
  /** 停在 merge 冲突中，七种冲突码齐全 */
  conflict: join(fixturesRoot, "conflict"),
  /** HEAD 游离 */
  detached: join(fixturesRoot, "detached"),
  /** 配了上游：含跟踪本地分支、`[gone]` */
  tracking: join(fixturesRoot, "tracking"),
  /** 带**真实** ssh 签名的提交，用于 `log.showSignature` */
  signed: join(fixturesRoot, "signed"),
} as const;

/** 共用的 `GitCli`。它无状态，不必每个测试新建。 */
export const cli = new GitCli("git");

/** 直接跑一条 git（**绕开被测代码**，用于搭场景与核对结果，不要用它来验被测行为）。 */
export function git(repo: string, args: readonly string[]): string {
  return execFileSync("git", [...args], { cwd: repo, encoding: "utf8", stdio: "pipe" });
}

const temps: string[] = [];

/**
 * 建一个可写的临时仓库，含一条 init 提交。
 *
 * 身份与时间**不固定**——临时仓库不需要稳定 hash（那是 fixture 的事），
 * 固定时间反而会让「两条提交时间相同」这类边界悄悄进来。
 */
export function makeTempRepo(name = "t"): string {
  const repo = mkdtempSync(join(tmpdir(), `dummygit-${name}-`));
  temps.push(repo);
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "t@example.com"]);
  git(repo, ["config", "user.name", "t"]);
  writeFileSync(join(repo, "f1"), "a\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "init"]);
  return repo;
}

/** 在 `afterEach` 里调用。漏调不会让测试失败，只会在 /tmp 里留垃圾。 */
export function cleanupTempRepos(): void {
  for (const repo of temps.splice(0)) {
    rmSync(repo, { recursive: true, force: true });
  }
}

/**
 * 给仓库装一个会 sleep 的 pre-commit 钩子，把 commit 的执行窗口撑开。
 *
 * 用途：验「运行中取消」「两条写命令是否真的排队」这类**时序**行为。
 * 不撑开的话 commit 只要十几毫秒，测出来的是运气不是行为——
 * 而且会安静地变成假绿（比如「取消」测到的其实是「起进程前就已取消」那条分支）。
 */
export function installSlowCommitHook(repo: string, seconds = 1): void {
  const hook = join(repo, ".git", "hooks", "pre-commit");
  writeFileSync(hook, `#!/bin/sh\nsleep ${seconds}\n`);
  chmodSync(hook, 0o755);
}
