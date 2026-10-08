import { afterEach, describe, expect, it } from "vitest";
import { cleanupTempRepos, cli, git, makeTempRepo } from "../../../__tests__/support.js";
import { fetchAll } from "../remote.js";

afterEach(cleanupTempRepos);

describe("fetchAll", () => {
  it("取回远程的分支；远程删掉的分支，记录也清掉（--prune）", async () => {
    const remote = makeTempRepo("remote");
    const repo = makeTempRepo("local");
    git(repo, ["remote", "add", "origin", remote]);
    git(remote, ["branch", "feature"]);

    await fetchAll.execute(cli, repo);
    expect(git(repo, ["branch", "-r"])).toContain("origin/feature");

    git(remote, ["branch", "-D", "feature"]);
    await fetchAll.execute(cli, repo);
    expect(git(repo, ["branch", "-r"])).not.toContain("origin/feature");
  });
});
