import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupTempRepos, cli, git, makeTempRepo } from "../../../__tests__/support.js";
import { getStashes, stashPaths } from "../stash.js";

afterEach(cleanupTempRepos);

describe("getStashes", () => {
  it("没有 stash：空列表", async () => {
    expect(await getStashes.execute(cli, makeTempRepo("no-stash"))).toEqual([]);
  });

  it("最新的在最前；带未跟踪文件的有 untracked，说明是 git 生成的", async () => {
    const repo = makeTempRepo("stashes");
    const base = git(repo, ["rev-parse", "HEAD"]).trim();
    writeFileSync(join(repo, "f1"), "changed\n");
    writeFileSync(join(repo, "new"), "u\n");
    git(repo, ["stash", "push", "-q", "-u"]);
    writeFileSync(join(repo, "f1"), "again\n");
    git(repo, ["stash", "push", "-q", "-m", "second: with colon"]);

    const [latest, older] = await getStashes.execute(cli, repo);
    expect(latest).toMatchObject({ base, message: "On main: second: with colon" });
    expect(latest).not.toHaveProperty("untracked");
    expect(older?.message).toMatch(/^WIP on main: [0-9a-f]+ init$/);
    expect(older?.untracked).toBe(git(repo, ["rev-parse", "stash@{1}^3"]).trim());
    expect(older?.hash).toBe(git(repo, ["rev-parse", "stash@{1}"]).trim());
    expect(Math.abs((older?.at ?? 0) - Date.now() / 1000)).toBeLessThan(60);
  });
});

describe("stashPaths", () => {
  /**
   * 没勾的：暂存的新增 n、暂存的改名 r → r2、暂存的删除 d、部分暂存的 p、未暂存的修改 f1；
   * 勾了的：未暂存的修改 s、未跟踪的 u。
   */
  const scene = () => {
    const repo = makeTempRepo("stash-paths");
    for (const file of ["s", "r", "d", "p"]) writeFileSync(join(repo, file), `${file}\n`);
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-qm", "files"]);
    writeFileSync(join(repo, "n"), "n\n");
    git(repo, ["add", "n"]);
    git(repo, ["mv", "r", "r2"]);
    git(repo, ["rm", "-q", "d"]);
    writeFileSync(join(repo, "p"), "staged\n");
    git(repo, ["add", "p"]);
    writeFileSync(join(repo, "p"), "worktree\n");
    writeFileSync(join(repo, "f1"), "changed\n");
    writeFileSync(join(repo, "s"), "changed\n");
    writeFileSync(join(repo, "u"), "u\n");
    return repo;
  };
  const status = (repo: string) => git(repo, ["status", "--porcelain"]).trimEnd().split("\n");

  it("没勾的已暂存改动不进 stash，暂存区原样留着", async () => {
    const repo = scene();
    const before = status(repo);
    await stashPaths.execute(cli, repo, ["s", "u"]);

    const stashed = git(repo, ["diff", "--name-only", "stash@{0}^1", "stash@{0}"]).trim();
    expect(stashed).toBe("s");
    expect(git(repo, ["ls-tree", "-r", "--name-only", "stash@{0}^3"]).trim()).toBe("u");
    expect(status(repo)).toEqual(before.filter((line) => line !== " M s" && line !== "?? u"));
    expect(git(repo, ["show", ":p"])).toBe("staged\n");
  });

  it("stash 失败也还原暂存区", async () => {
    // 勾了已暂存的删除又没先退回（见坑二）：git 报 pathspec did not match。
    const repo = scene();
    const before = status(repo);
    await expect(stashPaths.execute(cli, repo, ["d"])).rejects.toThrow(/pathspec/);
    expect(status(repo)).toEqual(before);
  });
});
