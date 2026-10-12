import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GitCli } from "../git/cli.js";
import type { RepositoryLocation } from "../git/commands/index.js";

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
/**
 * 一个远程仓库，和一个跟踪它的本地仓库：本地 `main` 是当前分支、跟踪 `origin/main`；
 * 另有 `other` 也跟踪 `origin/main`。拉取、推送的测试用。都是临时仓库，可写。
 */
export function makeTrackingRepos(): { remote: string; repo: string } {
  const remote = makeTempRepo("remote");
  const repo = makeTempRepo("local");
  git(repo, ["remote", "add", "origin", remote]);
  git(repo, ["fetch", "-q", "origin"]);
  git(repo, ["reset", "-q", "--hard", "origin/main"]);
  git(repo, ["branch", "-q", "-u", "origin/main"]);
  git(repo, ["branch", "-q", "--track", "other", "origin/main"]);
  return { remote, repo };
}

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

/**
 * 给**普通仓库**（不是 linked worktree、不是 submodule）拼出位置对象，省得每个测试都起一次 `rev-parse`。
 *
 * 只在测试里这样拼：生产代码一律经 `getRepositoryLocation` 问 git。
 * 要测 worktree 的场景，就用真命令，别用它。
 */
export function plainLocation(root: string): RepositoryLocation {
  const gitDir = join(root, ".git");
  return { root, gitDir, commonDir: gitDir };
}

/**
 * stash 取出冲突：`both.txt` 两边都改、`added.txt` 两边都新增、`gone.txt` stash 里删了 HEAD 改了（deleted by them）、
 * `clean.txt` 没有冲突。stash 取出时「我方」是 HEAD，「对方」是 stash。
 */
export function stashConflict(name: string): string {
  const repo = makeTempRepo(name);
  writeFileSync(join(repo, "both.txt"), "base\n");
  writeFileSync(join(repo, "gone.txt"), "base\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "base"]);
  writeFileSync(join(repo, "both.txt"), "stashed\n");
  writeFileSync(join(repo, "added.txt"), "stashed\n");
  git(repo, ["rm", "-q", "gone.txt"]);
  git(repo, ["add", "-A"]);
  git(repo, ["stash", "-q"]);
  writeFileSync(join(repo, "both.txt"), "committed\n");
  writeFileSync(join(repo, "added.txt"), "committed\n");
  writeFileSync(join(repo, "gone.txt"), "committed\n");
  writeFileSync(join(repo, "clean.txt"), "c\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "other"]);
  try {
    git(repo, ["stash", "pop", "-q"]);
  } catch {
    // 冲突时 git 以非 0 退出，这正是要的现场。
  }
  return repo;
}
