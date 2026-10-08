import { afterEach, describe, expect, it } from "vitest";
import { cleanupTempRepos, cli, git, makeTrackingRepos } from "../../../__tests__/support.js";
import { PushKind, push } from "../push.js";
import { listRemotes } from "../remote.js";

afterEach(cleanupTempRepos);

/** 测试用的远程是普通仓库：允许往它检出的分支推送。 */
function repos(): { remote: string; repo: string } {
  const { remote, repo } = makeTrackingRepos();
  git(remote, ["config", "receive.denyCurrentBranch", "ignore"]);
  return { remote, repo };
}

const tip = (repo: string, ref: string) => git(repo, ["rev-parse", ref]).trim();

describe("push", () => {
  it("有新提交：推上去", async () => {
    const { remote, repo } = repos();
    git(repo, ["commit", "-q", "--allow-empty", "-m", "local"]);
    const result = await push.execute(cli, repo, "origin", "main", "main", false);
    expect(result).toEqual({ kind: PushKind.Pushed });
    expect(tip(remote, "main")).toBe(tip(repo, "main"));
  });

  it("远程已经一样：已是最新", async () => {
    const { repo } = repos();
    expect(await push.execute(cli, repo, "origin", "main", "main", false)).toEqual({
      kind: PushKind.UpToDate,
    });
  });

  it("新分支带 -u：推到同名并设为上游", async () => {
    const { remote, repo } = repos();
    git(repo, ["branch", "-q", "feat"]);
    await push.execute(cli, repo, "origin", "feat", "feat", true);
    expect(tip(remote, "feat")).toBe(tip(repo, "feat"));
    expect(git(repo, ["rev-parse", "--abbrev-ref", "feat@{upstream}"]).trim()).toBe("origin/feat");
  });

  it("远程有本地没有的提交：被拒绝，远程不动", async () => {
    const { remote, repo } = repos();
    git(remote, ["commit", "-q", "--allow-empty", "-m", "remote"]);
    git(repo, ["commit", "-q", "--allow-empty", "-m", "local"]);
    const before = tip(remote, "main");
    const result = await push.execute(cli, repo, "origin", "main", "main", false);
    expect(result.kind).toBe(PushKind.Rejected);
    expect(tip(remote, "main")).toBe(before);
  });
});

describe("listRemotes", () => {
  it("列出全部远程的名字", async () => {
    const { repo } = repos();
    git(repo, ["remote", "add", "fork", "https://example.invalid/fork.git"]);
    expect(await listRemotes.execute(cli, repo)).toEqual(["fork", "origin"]);
  });
});
