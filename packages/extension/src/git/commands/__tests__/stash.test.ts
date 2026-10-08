import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupTempRepos, cli, git, makeTempRepo } from "../../../__tests__/support.js";
import { getStashes } from "../stash.js";

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
