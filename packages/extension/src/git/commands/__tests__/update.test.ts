import { afterEach, describe, expect, it } from "vitest";
import { cleanupTempRepos, cli, git, makeTrackingRepos } from "../../../__tests__/support.js";
import { FastForwardKind, fastForward } from "../update.js";

afterEach(cleanupTempRepos);

/** main 和 other 都停在 origin/main 的旧提交上；远程多一条提交，本地已经取回。 */
function behind(): { repo: string; tip: string } {
  const { remote, repo } = makeTrackingRepos();
  git(remote, ["commit", "-q", "--allow-empty", "-m", "remote"]);
  git(repo, ["fetch", "-q", "origin"]);
  return { repo, tip: git(repo, ["rev-parse", "origin/main"]) };
}

describe("fastForward", () => {
  it("是当前分支：快进它，HEAD 还在它上面", async () => {
    const { repo, tip } = behind();
    const result = await fastForward.execute(cli, repo, "main", "refs/remotes/origin/main");
    expect(result.kind).toBe(FastForwardKind.Done);
    expect(git(repo, ["rev-parse", "HEAD"])).toBe(tip);
  });

  it("取远程时切走了：快进的仍是给的分支，现在检出的那条不动", async () => {
    const { repo, tip } = behind();
    const other = git(repo, ["rev-parse", "other"]);
    git(repo, ["switch", "-q", "other"]);
    const result = await fastForward.execute(cli, repo, "main", "refs/remotes/origin/main");
    expect(result.kind).toBe(FastForwardKind.Done);
    expect(git(repo, ["rev-parse", "main"])).toBe(tip);
    expect(git(repo, ["rev-parse", "other"])).toBe(other);
    expect(git(repo, ["branch", "--show-current"]).trim()).toBe("other");
  });

  it("取远程时被删了：说不在了，不新建（fetch 写不存在的分支会建出来）", async () => {
    const { repo } = behind();
    git(repo, ["branch", "-q", "-D", "other"]);
    const result = await fastForward.execute(cli, repo, "other", "refs/remotes/origin/main");
    expect(result.kind).toBe(FastForwardKind.Missing);
    expect(git(repo, ["branch", "--list", "other"]).trim()).toBe("");
  });

  it("切走了且分叉：说分叉，两条都不动", async () => {
    const { repo } = behind();
    git(repo, ["commit", "-q", "--allow-empty", "-m", "local"]);
    const main = git(repo, ["rev-parse", "main"]);
    git(repo, ["switch", "-q", "other"]);
    const result = await fastForward.execute(cli, repo, "main", "refs/remotes/origin/main");
    expect(result.kind).toBe(FastForwardKind.Diverged);
    expect(git(repo, ["rev-parse", "main"])).toBe(main);
  });
});
