import { afterEach, describe, expect, it } from "vitest";
import { cleanupTempRepos, cli, git, makeTempRepo } from "../../../__tests__/support.js";
import { matchCommits } from "../log.js";

afterEach(cleanupTempRepos);

describe("matchCommits", () => {
  /** 四条提交，从旧到新。返回从新到旧的 hash（同骨架的顺序）与按说明查 hash 的表。 */
  const scene = () => {
    const repo = makeTempRepo("match");
    for (const message of ["Fix Login", "add a.b feature", "fix logout", "unrelated"]) {
      git(repo, ["commit", "-q", "--allow-empty", "-m", message]);
    }
    const hashes = git(repo, ["log", "--format=%H"]).trim().split("\n");
    const bySubject = new Map(
      git(repo, ["log", "--format=%s%x00%H"])
        .trim()
        .split("\n")
        .map((line) => {
          const [subject = "", hash = ""] = line.split("\0");
          return [subject, hash];
        }),
    );
    return { repo, hashes, bySubject };
  };

  it("不分大小写", async () => {
    const { repo, hashes, bySubject } = scene();
    const found = await matchCommits.execute(cli, repo, hashes, "FIX");
    expect(new Set(found)).toEqual(
      new Set([bySubject.get("Fix Login"), bySubject.get("fix logout")]),
    );
  });

  it("只在给的提交里找，不顺着父提交走", async () => {
    const { repo, hashes, bySubject } = scene();
    const found = await matchCommits.execute(cli, repo, hashes.slice(0, 2), "fix");
    expect(found).toEqual([bySubject.get("fix logout")]);
  });

  it("按普通文字，不当正则", async () => {
    const { repo, hashes } = scene();
    expect(await matchCommits.execute(cli, repo, hashes, "a.b")).toHaveLength(1);
    expect(await matchCommits.execute(cli, repo, hashes, "aXb")).toEqual([]);
  });
});
