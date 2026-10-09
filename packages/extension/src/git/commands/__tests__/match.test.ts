import { type MatchCondition, MatchKind } from "@dummy-git/shared";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupTempRepos, cli, git, makeTempRepo } from "../../../__tests__/support.js";
import { getIdentity } from "../identity.js";
import { listAuthors, matchCommits } from "../log.js";

afterEach(cleanupTempRepos);

const text = (value: string): MatchCondition => ({ kind: MatchKind.Text, text: value });

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
    const found = await matchCommits.execute(cli, repo, hashes, text("FIX"));
    expect(new Set(found)).toEqual(
      new Set([bySubject.get("Fix Login"), bySubject.get("fix logout")]),
    );
  });

  it("只在给的提交里找，不顺着父提交走", async () => {
    const { repo, hashes, bySubject } = scene();
    const found = await matchCommits.execute(cli, repo, hashes.slice(0, 2), text("fix"));
    expect(found).toEqual([bySubject.get("fix logout")]);
  });

  it("按普通文字，不当正则", async () => {
    const { repo, hashes } = scene();
    expect(await matchCommits.execute(cli, repo, hashes, text("a.b"))).toHaveLength(1);
    expect(await matchCommits.execute(cli, repo, hashes, text("aXb"))).toEqual([]);
  });
});

describe("按作者", () => {
  /** 三个作者：名字里带点的、带 x 的（`.` 若被当正则会误中它）、邮箱为空的。 */
  const scene = () => {
    const repo = makeTempRepo("authors");
    const commitAs = (name: string, email: string) =>
      git(repo, [
        "-c",
        `user.name=${name}`,
        "-c",
        `user.email=${email}`,
        "commit",
        "-q",
        "--allow-empty",
        "-m",
        name,
      ]);
    commitAs("A.B Smith", "ab@x.com");
    commitAs("A.B Smith", "ab@x.com");
    commitAs("AxB Smith", "axb@x.com");
    commitAs("Nobody", "");
    return { repo, hashes: git(repo, ["log", "--format=%H"]).trim().split("\n") };
  };
  const author = (name: string, email: string): MatchCondition => ({
    kind: MatchKind.Author,
    name,
    email,
  });

  it("listAuthors：每人几条，从多到少", async () => {
    const { repo, hashes } = scene();
    expect(await listAuthors.execute(cli, repo, hashes)).toEqual([
      { name: "A.B Smith", email: "ab@x.com", count: 2 },
      { name: "AxB Smith", email: "axb@x.com", count: 1 },
      { name: "Nobody", email: "", count: 1 },
      { name: "t", email: "t@example.com", count: 1 },
    ]);
  });

  it("matchCommits：名字与邮箱按普通文字整串比，邮箱为空的也找得到", async () => {
    const { repo, hashes } = scene();
    expect(
      await matchCommits.execute(cli, repo, hashes, author("A.B Smith", "ab@x.com")),
    ).toHaveLength(2);
    expect(await matchCommits.execute(cli, repo, hashes, author("Nobody", ""))).toHaveLength(1);
  });

  it("getIdentity：读 git 配置的名字与邮箱，名字没配就没有", async () => {
    const repo = makeTempRepo("identity");
    expect(await getIdentity.execute(cli, repo)).toEqual({ name: "t", email: "t@example.com" });
    git(repo, ["config", "user.name", ""]);
    expect(await getIdentity.execute(cli, repo)).toBeUndefined();
  });
});
