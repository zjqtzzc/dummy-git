import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupTempRepos, cli, git, makeTempRepo } from "../../../__tests__/support.js";
import { GitFailureError } from "../../failure.js";
import { getRepositoryLocation } from "../location.js";

afterEach(cleanupTempRepos);

// realpathSync 是因为 /tmp 在部分平台是符号链接（如 macOS 的 /private/tmp），
// 而 git 给的是展开后的真实路径。

describe("getRepositoryLocation：整条链路的第一环", () => {
  it("普通仓库：根、git 目录、共享目录", async () => {
    const repo = realpathSync(makeTempRepo("loc-top"));
    expect(await getRepositoryLocation.execute(cli, repo)).toEqual({
      root: repo,
      gitDir: join(repo, ".git"),
      commonDir: join(repo, ".git"),
    });
  });

  it("从子目录问，结果与从根目录问相同——共享目录的相对路径是相对执行目录的", async () => {
    // 这里 git 给的共享目录是 `../../.git`，不自己解析就会拿到一个相对路径。
    const repo = realpathSync(makeTempRepo("loc-subdir"));
    const deep = join(repo, "src", "deep");
    mkdirSync(deep, { recursive: true });
    expect(await getRepositoryLocation.execute(cli, deep)).toEqual({
      root: repo,
      gitDir: join(repo, ".git"),
      commonDir: join(repo, ".git"),
    });
  });

  it("linked worktree：git 目录在主仓库的 worktrees/ 下，共享目录是主仓库的 .git", async () => {
    // 这里 `<根>/.git` 是个文本文件。写死 `.git` 的代码在这里什么都读不到。
    const main = realpathSync(makeTempRepo("loc-main"));
    const worktree = `${main}-wt`;
    git(main, ["worktree", "add", "-q", worktree, "-b", "wt"]);
    try {
      const sub = join(worktree, "sub");
      mkdirSync(sub);
      expect(await getRepositoryLocation.execute(cli, sub)).toEqual({
        root: worktree,
        // git 以 worktree 目录的名字在 worktrees/ 下建子目录
        gitDir: join(main, ".git", "worktrees", basename(worktree)),
        commonDir: join(main, ".git"),
      });
    } finally {
      rmSync(worktree, { recursive: true, force: true });
    }
  });

  it("不是仓库 → 抛 GitFailureError（code: NotAGitRepository）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "not-a-repo-"));
    await expect(getRepositoryLocation.execute(cli, dir)).rejects.toBeInstanceOf(GitFailureError);
  });
});
