import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { PushTagMode } from "@dummy-git/shared";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupTempRepos, cli, git, makeTrackingRepos } from "../../../__tests__/support.js";
import { GitFailureError } from "../../failure.js";
import { getOutgoingCommits } from "../log.js";
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
    const result = await push.execute(cli, repo, "origin", "main", "main", false, false, undefined);
    expect(result).toEqual({ kind: PushKind.Pushed, rejectedTags: [] });
    expect(tip(remote, "main")).toBe(tip(repo, "main"));
  });

  it("远程已经一样：已是最新", async () => {
    const { repo } = repos();
    expect(
      await push.execute(cli, repo, "origin", "main", "main", false, false, undefined),
    ).toEqual({
      kind: PushKind.UpToDate,
      rejectedTags: [],
    });
  });

  it("新分支带 -u：推到同名并设为上游", async () => {
    const { remote, repo } = repos();
    git(repo, ["branch", "-q", "feat"]);
    await push.execute(cli, repo, "origin", "feat", "feat", true, false, undefined);
    expect(tip(remote, "feat")).toBe(tip(repo, "feat"));
    expect(git(repo, ["rev-parse", "--abbrev-ref", "feat@{upstream}"]).trim()).toBe("origin/feat");
  });

  it("远程有本地没有的提交：被拒绝，远程不动", async () => {
    const { remote, repo } = repos();
    git(remote, ["commit", "-q", "--allow-empty", "-m", "remote"]);
    git(repo, ["commit", "-q", "--allow-empty", "-m", "local"]);
    const before = tip(remote, "main");
    const result = await push.execute(cli, repo, "origin", "main", "main", false, false, undefined);
    expect(result.kind).toBe(PushKind.Rejected);
    expect(tip(remote, "main")).toBe(before);
  });

  it("远程钩子拒绝：不是「先 Update」能解决的，按 git 失败抛出", async () => {
    const { remote, repo } = repos();
    writeFileSync(join(remote, ".git", "hooks", "pre-receive"), "#!/bin/sh\nexit 1\n", {
      mode: 0o755,
    });
    git(repo, ["commit", "-q", "--allow-empty", "-m", "local"]);
    await expect(
      push.execute(cli, repo, "origin", "main", "main", false, false, undefined),
    ).rejects.toBeInstanceOf(GitFailureError);
  });
});

describe("push --force-with-lease", () => {
  /** 远程多一条本地没有的提交，且本地已经 fetch 过它。 */
  function diverged(): { remote: string; repo: string } {
    const { remote, repo } = repos();
    git(remote, ["commit", "-q", "--allow-empty", "-m", "remote"]);
    git(repo, ["fetch", "-q"]);
    git(repo, ["commit", "-q", "--allow-empty", "-m", "local"]);
    return { remote, repo };
  }

  it("远程还停在上次 fetch 看到的位置：覆盖掉", async () => {
    const { remote, repo } = diverged();
    const result = await push.execute(cli, repo, "origin", "main", "main", false, true, undefined);
    expect(result).toEqual({ kind: PushKind.Pushed, rejectedTags: [] });
    expect(tip(remote, "main")).toBe(tip(repo, "main"));
  });

  it("上次 fetch 之后远程又变了：被拒绝，远程不动", async () => {
    const { remote, repo } = diverged();
    git(remote, ["commit", "-q", "--allow-empty", "-m", "someone else"]);
    const before = tip(remote, "main");
    const result = await push.execute(cli, repo, "origin", "main", "main", false, true, undefined);
    expect(result.kind).toBe(PushKind.Rejected);
    expect(tip(remote, "main")).toBe(before);
  });
});

describe("push 带 tag", () => {
  const remoteTags = (remote: string) => git(remote, ["tag", "--list"]).trim().split("\n");

  /** 本地一个轻量 tag、一个附注 tag，都在要推的提交上。 */
  function tagged(): { remote: string; repo: string } {
    const { remote, repo } = repos();
    git(repo, ["commit", "-q", "--allow-empty", "-m", "local"]);
    git(repo, ["tag", "light"]);
    git(repo, ["tag", "-a", "annotated", "-m", "annotated"]);
    return { remote, repo };
  }

  it("All：轻量 tag 和附注 tag 都推上去", async () => {
    const { remote, repo } = tagged();
    await push.execute(cli, repo, "origin", "main", "main", false, false, PushTagMode.All);
    expect(remoteTags(remote)).toEqual(["annotated", "light"]);
  });

  it("Follow：只推附注 tag，轻量 tag 留在本地", async () => {
    const { remote, repo } = tagged();
    await push.execute(cli, repo, "origin", "main", "main", false, false, PushTagMode.Follow);
    expect(remoteTags(remote)).toEqual(["annotated"]);
  });

  /** 远程已有 `v1`，指向的不是本地 `v1` 那条提交。 */
  function conflicting(): { remote: string; repo: string } {
    const { remote, repo } = repos();
    git(remote, ["tag", "v1"]);
    git(repo, ["commit", "-q", "--allow-empty", "-m", "local"]);
    git(repo, ["tag", "v1"]);
    return { remote, repo };
  }

  it("远程已有同名 tag：分支照样推上去，被拒的 tag 列在结果里", async () => {
    const { remote, repo } = conflicting();
    const before = tip(remote, "v1");
    const result = await push.execute(
      cli,
      repo,
      "origin",
      "main",
      "main",
      false,
      false,
      PushTagMode.All,
    );
    expect(result).toEqual({
      kind: PushKind.Pushed,
      rejectedTags: [{ name: "v1", summary: "[rejected] (already exists)" }],
    });
    expect(tip(remote, "main")).toBe(tip(repo, "main"));
    expect(tip(remote, "v1")).toBe(before);
  });

  it("Force Push 也不覆盖远程的同名 tag", async () => {
    const { remote, repo } = conflicting();
    const before = tip(remote, "v1");
    const result = await push.execute(
      cli,
      repo,
      "origin",
      "main",
      "main",
      false,
      true,
      PushTagMode.All,
    );
    expect(result.kind).toBe(PushKind.Pushed);
    expect(result.kind === PushKind.Pushed && result.rejectedTags.map((tag) => tag.name)).toEqual([
      "v1",
    ]);
    expect(tip(remote, "v1")).toBe(before);
  });
});

describe("getOutgoingCommits", () => {
  const subjects = async (repo: string, branch: string, remote: string, remoteBranch?: string) =>
    (await getOutgoingCommits.execute(cli, repo, 10, branch, remote, remoteBranch)).map(
      (commit) => commit.message,
    );

  it("远程分支已有记录：本地有、它没有的，最新的在前", async () => {
    const { repo } = repos();
    git(repo, ["commit", "-q", "--allow-empty", "-m", "one"]);
    git(repo, ["commit", "-q", "--allow-empty", "-m", "two"]);
    expect(await subjects(repo, "main", "origin", "main")).toEqual(["two", "one"]);
  });

  it("远程上还没有这个分支：只排除那个远程已有的提交，别的远程上的不算", async () => {
    const { repo } = repos();
    git(repo, ["switch", "-q", "-c", "feat"]);
    git(repo, ["commit", "-q", "--allow-empty", "-m", "on fork"]);
    // fork 是另一个远程：它的分支记录里有 "on fork"，但推到 origin 时这条仍要推。
    git(repo, ["update-ref", "refs/remotes/fork/feat", "HEAD"]);
    git(repo, ["commit", "-q", "--allow-empty", "-m", "new"]);
    expect(await subjects(repo, "feat", "origin")).toEqual(["new", "on fork"]);
    expect(await subjects(repo, "feat", "fork")).toEqual(["new"]);
  });

  it("最多 limit 条", async () => {
    const { repo } = repos();
    git(repo, ["commit", "-q", "--allow-empty", "-m", "one"]);
    git(repo, ["commit", "-q", "--allow-empty", "-m", "two"]);
    const commits = await getOutgoingCommits.execute(cli, repo, 1, "main", "origin", "main");
    expect(commits.map((commit) => commit.message)).toEqual(["two"]);
  });
});

describe("listRemotes", () => {
  it("列出全部远程的名字", async () => {
    const { repo } = repos();
    git(repo, ["remote", "add", "fork", "https://example.invalid/fork.git"]);
    expect(await listRemotes.execute(cli, repo)).toEqual(["fork", "origin"]);
  });
});
