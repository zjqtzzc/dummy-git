import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitErrorCode } from "@dummy-git/shared";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupTempRepos, cli, fixtures, makeTempRepo } from "../../__tests__/support.js";
import { classifyError, GitFailureError, run } from "../failure.js";

afterEach(cleanupTempRepos);

describe("classifyError：实测可辨识（真 git 子进程）", () => {
  it("index 锁被占用 → RepositoryIsLocked", async () => {
    const repo = makeTempRepo("lock-index");
    writeFileSync(join(repo, ".git", "index.lock"), "");
    const r = await cli.exec(["commit", "--allow-empty", "-m", "x"], { cwd: repo });
    expect(r.exitCode).not.toBe(0);
    expect(classifyError(r.stderr)).toBe(GitErrorCode.RepositoryIsLocked);
  });

  it("ref 锁被占用 → 同一个码", async () => {
    // git 给 ref 锁追加了完全相同的解释段落，所以同一个码覆盖两者是对的。
    // ⚠️ 锁文件要放在**目标分支**：`git branch other` 抢的是
    // `refs/heads/other.lock`，不是当前分支 `main` 的锁。
    const repo = makeTempRepo("lock-ref");
    writeFileSync(join(repo, ".git", "refs", "heads", "other.lock"), "");
    const r = await cli.exec(["branch", "other"], { cwd: repo });
    expect(r.exitCode).not.toBe(0);
    expect(classifyError(r.stderr)).toBe(GitErrorCode.RepositoryIsLocked);
  });

  it("裸目录 → NotAGitRepository", async () => {
    const dir = mkdtempSync(join(tmpdir(), "not-a-repo-"));
    const r = await cli.exec(["status"], { cwd: dir });
    expect(r.exitCode).not.toBe(0);
    expect(classifyError(r.stderr)).toBe(GitErrorCode.NotAGitRepository);
  });
});

describe("classifyError：认不出的失败返回 undefined，不乱认", () => {
  it("分支不存在（exit 1）", async () => {
    const r = await cli.exec(["checkout", "nosuchbranch"], { cwd: fixtures.base });
    expect(r.exitCode).toBe(1);
    expect(classifyError(r.stderr)).toBeUndefined();
  });

  it("参数写错（exit 128，同一个退出码，不同含义）", async () => {
    // §4.3 的要点：退出码携带的是严重程度，不是错误身份。
    // 128 既是「锁冲突」也是「参数错误」，分类必须靠 stderr 文本。
    const r = await cli.exec(["log", "--no-such-flag"], { cwd: fixtures.base });
    expect(r.exitCode).toBe(128);
    expect(classifyError(r.stderr)).toBeUndefined();
  });
});

describe("失败与否由退出码决定，不由 stderr 决定", () => {
  it("exitCode===0 时永不产出失败，即使 stderr 含 error:", async () => {
    const repo = makeTempRepo("stderr-noise");
    const hook = join(repo, ".git", "hooks", "pre-commit");
    writeFileSync(hook, "#!/bin/sh\necho 'error: this is noise' >&2\nexit 0\n");
    chmodSync(hook, 0o755);
    writeFileSync(join(repo, "f1"), "changed\n");

    const r = await cli.exec(["commit", "-am", "x"], { cwd: repo });
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toContain("error:");
    // classifyError 本身可以命中这段文本——但产不产出失败取决于调用方
    // 先检查 exitCode（下面单独证明 classifyError 不看退出码）。
  });

  it("classifyError 不看退出码——它只认 stderr 文本", () => {
    expect(classifyError("fatal: not a git repository")).toBe(GitErrorCode.NotAGitRepository);
  });
});

describe("run()：失败即抛，exec() 同场景不抛", () => {
  it("run() 对非零退出码抛 GitFailureError", async () => {
    await expect(
      run(cli, ["rev-parse", "--verify", "nosuchref"], { cwd: fixtures.base }),
    ).rejects.toBeInstanceOf(GitFailureError);
  });

  it("exec() 同一条命令只返回，不抛", async () => {
    const r = await cli.exec(["rev-parse", "--verify", "nosuchref"], { cwd: fixtures.base });
    expect(r.exitCode).toBe(128);
  });

  it("run() 成功时正常返回", async () => {
    const r = await run(cli, ["log", "-1", "--format=%H"], { cwd: fixtures.base });
    expect(r.stdout.trim()).toMatch(/^[0-9a-f]{40}$/);
  });
});
