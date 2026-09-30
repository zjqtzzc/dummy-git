import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanupTempRepos,
  cli,
  git,
  installSlowCommitHook,
  makeTempRepo,
} from "../../../__tests__/support.js";
import { runCommand } from "../../../core/executor.js";
import { CommandQueue } from "../../../core/operation.js";
import { commit } from "../commit.js";
import { getStatus } from "../status.js";

afterEach(cleanupTempRepos);

describe("commit：--only 只提交勾选的路径", () => {
  it("已跟踪文件改动：勾选的那个进了提交，工作区变干净", async () => {
    const repo = makeTempRepo("only-tracked");
    writeFileSync(join(repo, "f1"), "changed\n");
    await commit.execute(cli, repo, "msg", ["f1"]);
    expect(git(repo, ["log", "-1", "--format=%s"]).trim()).toBe("msg");
    expect(git(repo, ["status", "--porcelain"]).trim()).toBe("");
  });

  it("已删除已暂存：--only 直接工作（旧仓库 exit 128 的那类 bug 不会发生）", async () => {
    // 用户考古出的真实 bug：旧仓库对不同的 worktree 状态分别判断该不该
    // 传 pathspec，删除+已暂存的组合曾漏判导致 exit 128。
    // 这里的规则更简单：--only 对所有已跟踪状态都直接可用，不用分支判断。
    const repo = makeTempRepo("only-deleted-staged");
    rmSync(join(repo, "f1"));
    git(repo, ["add", "-A"]);
    await commit.execute(cli, repo, "delete f1", ["f1"]);
    expect(git(repo, ["log", "-1", "--format=%s"]).trim()).toBe("delete f1");
  });

  it("其余未勾选文件的改动仍留在暂存区", async () => {
    const repo = makeTempRepo("only-partial");
    writeFileSync(join(repo, "f1"), "changed\n");
    writeFileSync(join(repo, "f2"), "new\n");
    git(repo, ["add", "-A"]);

    await commit.execute(cli, repo, "only f1", ["f1"]);

    expect(git(repo, ["log", "-1", "--format=%s"]).trim()).toBe("only f1");
    expect(git(repo, ["status", "--porcelain"])).toContain("f2");
  });
});

describe("getStatus：命令层为它传了 GIT_OPTIONAL_LOCKS=0", () => {
  it("跨 M2→M3→M5 的欠条已兑现", async () => {
    const repo = makeTempRepo("locks-env");
    writeFileSync(join(repo, "f1"), "changed\n");
    const { changes } = await getStatus.execute(cli, repo);
    expect(changes.length).toBeGreaterThan(0);
  });
});

describe("真 git：队列决定「改动会不会丢」", () => {
  /** 集成版的 demo-race 场景①②。pre-commit 钩子撑开窗口，让竞争稳定可复现。 */
  it("不过队列：两条并发 commit，内容会丢", async () => {
    const repo = makeTempRepo("race-no-queue");
    installSlowCommitHook(repo, 0.3);
    writeFileSync(join(repo, "a.txt"), "A\n");
    writeFileSync(join(repo, "b.txt"), "B\n");
    git(repo, ["add", "-A"]);

    const results = await Promise.allSettled([
      commit.execute(cli, repo, "commit A", ["a.txt"]),
      commit.execute(cli, repo, "commit B", ["b.txt"]),
    ]);

    expect(results.some((r) => r.status === "rejected")).toBe(true);
    const count = Number(git(repo, ["rev-list", "--count", "HEAD"]).trim());
    expect(count).toBe(2); // init + 只有一条成功
  });

  it("过队列：两条 commit 都进历史，不丢内容", async () => {
    const repo = makeTempRepo("race-with-queue");
    installSlowCommitHook(repo, 0.3);
    writeFileSync(join(repo, "a.txt"), "A\n");
    writeFileSync(join(repo, "b.txt"), "B\n");
    git(repo, ["add", "-A"]);

    const queue = new CommandQueue();
    await Promise.all([
      runCommand(queue, cli, commit, repo, "commit A", ["a.txt"]),
      runCommand(queue, cli, commit, repo, "commit B", ["b.txt"]),
    ]);

    const count = Number(git(repo, ["rev-list", "--count", "HEAD"]).trim());
    expect(count).toBe(3); // init + 两条都成功
  });
});
