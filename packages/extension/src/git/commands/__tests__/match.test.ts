import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type MatchCondition, MatchKind } from "@dummy-git/shared";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupTempRepos, cli, git, makeTempRepo } from "../../../__tests__/support.js";
import { getIdentity } from "../identity.js";
import { getSkeleton, listAuthors, matchCommits } from "../log.js";
import { listPaths } from "../paths.js";

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

describe("按路径", () => {
  /** src/a/x.txt 改过两次；`b*.txt` 改过一次（名字里的 `*` 若当通配符会误中 `bb.txt`）。 */
  const scene = () => {
    const repo = makeTempRepo("paths");
    mkdirSync(join(repo, "src/a"), { recursive: true });
    for (const [file, message] of [
      ["src/a/x.txt", "x1"],
      ["b*.txt", "star"],
      ["bb.txt", "bb"],
      ["src/a/x.txt", "x2"],
    ] as const) {
      writeFileSync(join(repo, file), message);
      git(repo, ["add", "-A"]);
      git(repo, ["commit", "-q", "-m", message]);
    }
    const hashes = git(repo, ["log", "--format=%H"]).trim().split("\n");
    const subjects = async (path: string) => {
      const found = new Set(
        await matchCommits.execute(cli, repo, hashes, { kind: MatchKind.Path, path }),
      );
      return git(repo, ["log", "--format=%H %s"])
        .trim()
        .split("\n")
        .filter((line) => found.has(line.split(" ")[0] ?? ""))
        .map((line) => line.split(" ")[1]);
    };
    return { repo, subjects };
  };

  it("目录与文件都能筛；路径按字面，不当通配符", async () => {
    const { subjects } = scene();
    expect(await subjects("src")).toEqual(["x2", "x1"]);
    expect(await subjects("src/a/x.txt")).toEqual(["x2", "x1"]);
    expect(await subjects("b*.txt")).toEqual(["star"]);
  });

  it("listPaths：被跟踪的文件与推出的目录，按路径排序", async () => {
    const { repo } = scene();
    expect(await listPaths.execute(cli, repo)).toEqual([
      { path: "b*.txt", folder: false },
      { path: "bb.txt", folder: false },
      { path: "f1", folder: false },
      { path: "src", folder: true },
      { path: "src/a", folder: true },
      { path: "src/a/x.txt", folder: false },
    ]);
  });
});

describe("getSkeleton 按分支", () => {
  it("只走这个分支：别的分支独有的提交不在里面", async () => {
    const repo = makeTempRepo("skeleton-branch");
    git(repo, ["switch", "-q", "-c", "side"]);
    git(repo, ["commit", "-q", "--allow-empty", "-m", "side only"]);
    git(repo, ["switch", "-q", "main"]);
    git(repo, ["commit", "-q", "--allow-empty", "-m", "main only"]);
    const subjects = async (options: { branch?: string }) => {
      const hashes = new Set((await getSkeleton.execute(cli, repo, options)).map((c) => c.hash));
      return git(repo, ["log", "--all", "--format=%H %s"])
        .trim()
        .split("\n")
        .filter((line) => hashes.has(line.slice(0, 40)))
        .map((line) => line.slice(41));
    };
    expect((await subjects({})).sort()).toEqual(["init", "main only", "side only"]);
    expect(await subjects({ branch: "refs/heads/side" })).toEqual(["side only", "init"]);
  });
});
