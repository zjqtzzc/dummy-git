import { afterEach, describe, expect, it } from "vitest";
import { cleanupTempRepos, cli, git, makeTrackingRepos } from "../../../__tests__/support.js";
import { FastForwardKind, fastForward, fetchBranch, fetchInto } from "../pull.js";

afterEach(cleanupTempRepos);

const head = (repo: string, ref: string) => git(repo, ["rev-parse", ref]).trim();

describe("拉取非当前分支：fetchInto", () => {
  it("远程有新提交：本地分支快进到远程", async () => {
    const { remote, repo } = makeTrackingRepos();
    git(remote, ["commit", "-q", "--allow-empty", "-m", "remote"]);
    const result = await fetchInto.execute(cli, repo, "origin", "main", "other");
    expect(result).toEqual({ kind: FastForwardKind.Done });
    expect(head(repo, "other")).toBe(head(remote, "main"));
    // 远程分支记录也跟着更新了。
    expect(head(repo, "origin/main")).toBe(head(remote, "main"));
  });

  it("两边各有新提交：不能快进，本地分支不动", async () => {
    const { remote, repo } = makeTrackingRepos();
    git(remote, ["commit", "-q", "--allow-empty", "-m", "remote"]);
    git(repo, ["checkout", "-q", "other"]);
    git(repo, ["commit", "-q", "--allow-empty", "-m", "local"]);
    const before = head(repo, "other");
    git(repo, ["checkout", "-q", "main"]);
    const result = await fetchInto.execute(cli, repo, "origin", "main", "other");
    expect(result.kind).toBe(FastForwardKind.Diverged);
    expect(head(repo, "other")).toBe(before);
  });
});

describe("拉取当前分支：fetchBranch + fastForward", () => {
  it("远程有新提交：当前分支与工作区快进到远程", async () => {
    const { remote, repo } = makeTrackingRepos();
    git(remote, ["commit", "-q", "--allow-empty", "-m", "remote"]);
    await fetchBranch.execute(cli, repo, "origin", "main");
    const result = await fastForward.execute(cli, repo, "refs/remotes/origin/main");
    expect(result).toEqual({ kind: FastForwardKind.Done });
    expect(head(repo, "HEAD")).toBe(head(remote, "main"));
  });

  it("两边各有新提交：不能快进，当前分支不动", async () => {
    const { remote, repo } = makeTrackingRepos();
    git(remote, ["commit", "-q", "--allow-empty", "-m", "remote"]);
    git(repo, ["commit", "-q", "--allow-empty", "-m", "local"]);
    const before = head(repo, "HEAD");
    await fetchBranch.execute(cli, repo, "origin", "main");
    const result = await fastForward.execute(cli, repo, "refs/remotes/origin/main");
    expect(result.kind).toBe(FastForwardKind.Diverged);
    expect(head(repo, "HEAD")).toBe(before);
  });
});
