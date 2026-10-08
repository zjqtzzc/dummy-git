import { afterEach, describe, expect, it } from "vitest";
import { cleanupTempRepos, cli, git, makeTempRepo } from "../../../__tests__/support.js";
import { switchBranch } from "../branch.js";

afterEach(cleanupTempRepos);

describe("switchBranch", () => {
  it("切到本地分支，返回 git 自己说的那句", async () => {
    const repo = makeTempRepo("switch");
    git(repo, ["branch", "-q", "feat"]);
    const said = await switchBranch.execute(cli, repo, "feat");
    expect(said).toBe("Switched to branch 'feat'");
    expect(git(repo, ["branch", "--show-current"]).trim()).toBe("feat");
  });
});
