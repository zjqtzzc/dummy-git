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
import { amendCommit, commit } from "../commit.js";

afterEach(cleanupTempRepos);

describe("commit：--only 只提交勾选的路径", () => {
  it("已跟踪文件改动：勾选的那个进了提交，工作区变干净", async () => {
    const repo = makeTempRepo("only-tracked");
    writeFileSync(join(repo, "f1"), "changed\n");
    await commit.execute(cli, repo, "msg", ["f1"], []);
    expect(git(repo, ["log", "-1", "--format=%s"]).trim()).toBe("msg");
    expect(git(repo, ["status", "--porcelain"]).trim()).toBe("");
  });

  it("已删除已暂存：--only 直接工作，不需要先 add（add 会 exit 128）", async () => {
    // --only 对所有已跟踪状态都直接可用，不用按状态分支判断。
    const repo = makeTempRepo("only-deleted-staged");
    rmSync(join(repo, "f1"));
    git(repo, ["add", "-A"]);
    await commit.execute(cli, repo, "delete f1", ["f1"], []);
    expect(git(repo, ["log", "-1", "--format=%s"]).trim()).toBe("delete f1");
  });

  it("其余未勾选文件的改动仍留在暂存区", async () => {
    const repo = makeTempRepo("only-partial");
    writeFileSync(join(repo, "f1"), "changed\n");
    writeFileSync(join(repo, "f2"), "new\n");
    git(repo, ["add", "-A"]);

    await commit.execute(cli, repo, "only f1", ["f1"], []);

    expect(git(repo, ["log", "-1", "--format=%s"]).trim()).toBe("only f1");
    expect(git(repo, ["status", "--porcelain"])).toContain("f2");
  });

  it("已跟踪路径里的 [] 不当通配符：旁边的改动不进提交", async () => {
    const repo = makeTempRepo("literal-only");
    writeFileSync(join(repo, "foo[bar].txt"), "x\n");
    writeFileSync(join(repo, "fooa.txt"), "a\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-qm", "files"]);
    writeFileSync(join(repo, "foo[bar].txt"), "xx\n");
    writeFileSync(join(repo, "fooa.txt"), "aa\n");
    await commit.execute(cli, repo, "only bracket", ["foo[bar].txt"], []);
    expect(git(repo, ["show", "--name-status", "--format=", "HEAD"]).trim()).toBe(
      "M\tfoo[bar].txt",
    );
    expect(git(repo, ["status", "--porcelain"]).trimEnd()).toBe(" M fooa.txt");
  });
});

describe("commit：未跟踪文件先 add 再提交", () => {
  it("勾了未跟踪文件：它进了提交", async () => {
    const repo = makeTempRepo("untracked");
    writeFileSync(join(repo, "new.txt"), "new\n");
    await commit.execute(cli, repo, "add new", ["new.txt"], ["new.txt"]);
    expect(git(repo, ["show", "--name-status", "--format=", "HEAD"]).trim()).toBe("A\tnew.txt");
    expect(git(repo, ["status", "--porcelain"]).trim()).toBe("");
  });

  it("提交失败（钩子拒绝）：刚 add 的未跟踪文件撤回，仍是未跟踪", async () => {
    const repo = makeTempRepo("untracked-hook");
    writeFileSync(join(repo, ".git", "hooks", "pre-commit"), "#!/bin/sh\nexit 1\n", {
      mode: 0o755,
    });
    writeFileSync(join(repo, "new.txt"), "new\n");
    await expect(commit.execute(cli, repo, "msg", ["new.txt"], ["new.txt"])).rejects.toThrow();
    expect(git(repo, ["status", "--porcelain"]).trim()).toBe("?? new.txt");
  });

  it("未跟踪文件 add 失败：不提交", async () => {
    const repo = makeTempRepo("untracked-fail");
    writeFileSync(join(repo, "f1"), "changed\n");
    // 声称未跟踪、实际不存在的路径：add 报 pathspec 不匹配，f1 也不能被提交。
    await expect(
      commit.execute(cli, repo, "msg", ["f1", "gone.txt"], ["gone.txt"]),
    ).rejects.toThrow();
    expect(git(repo, ["rev-list", "--count", "HEAD"]).trim()).toBe("1");
  });

  it("未跟踪路径里的 [] 不当通配符：旁边的文件仍是未跟踪", async () => {
    const repo = makeTempRepo("literal-add");
    writeFileSync(join(repo, "foo[bar].txt"), "x\n");
    writeFileSync(join(repo, "fooa.txt"), "a\n");
    writeFileSync(join(repo, "foor.txt"), "r\n");
    await commit.execute(cli, repo, "only bracket", ["foo[bar].txt"], ["foo[bar].txt"]);
    expect(git(repo, ["show", "--name-status", "--format=", "HEAD"]).trim()).toBe(
      "A\tfoo[bar].txt",
    );
    expect(git(repo, ["status", "--porcelain"]).trim().split("\n")).toEqual([
      "?? fooa.txt",
      "?? foor.txt",
    ]);
  });
});

describe("amendCommit", () => {
  it("不勾文件：只改说明，暂存区里已有的改动不带进去", async () => {
    const repo = makeTempRepo("amend-message");
    const before = git(repo, ["rev-parse", "HEAD^{tree}"]);
    writeFileSync(join(repo, "f1"), "staged\n");
    git(repo, ["add", "f1"]);
    await amendCommit.execute(cli, repo, "new message", [], []);
    expect(git(repo, ["log", "-1", "--format=%s"]).trim()).toBe("new message");
    expect(git(repo, ["rev-parse", "HEAD^{tree}"])).toBe(before);
    expect(git(repo, ["status", "--porcelain"]).trim()).toBe("M  f1");
  });

  it("勾了文件：并进最近一次提交，不多出一条", async () => {
    const repo = makeTempRepo("amend-files");
    writeFileSync(join(repo, "f1"), "changed\n");
    await amendCommit.execute(cli, repo, "amended", ["f1"], []);
    expect(git(repo, ["rev-list", "--count", "HEAD"]).trim()).toBe("1");
    expect(git(repo, ["status", "--porcelain"]).trim()).toBe("");
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
      commit.execute(cli, repo, "commit A", ["a.txt"], []),
      commit.execute(cli, repo, "commit B", ["b.txt"], []),
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
      runCommand(queue, cli, commit, repo, "commit A", ["a.txt"], []),
      runCommand(queue, cli, commit, repo, "commit B", ["b.txt"], []),
    ]);

    const count = Number(git(repo, ["rev-list", "--count", "HEAD"]).trim());
    expect(count).toBe(3); // init + 两条都成功
  });
});
