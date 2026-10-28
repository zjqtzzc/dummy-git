import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupTempRepos, cli, git, makeTempRepo } from "../../../__tests__/support.js";
import { applyStashFiles, getStashes, renameStash, stashPaths, unstage } from "../stash.js";

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

describe("stashPaths", () => {
  /**
   * 没选的：暂存的新增 n、暂存的改名 r → r2、暂存的删除 d、部分暂存的 p、未暂存的修改 f1；
   * 选中的：未暂存的修改 s、未跟踪的 u。
   */
  const scene = () => {
    const repo = makeTempRepo("stash-paths");
    for (const file of ["s", "r", "d", "p"]) writeFileSync(join(repo, file), `${file}\n`);
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-qm", "files"]);
    writeFileSync(join(repo, "n"), "n\n");
    git(repo, ["add", "n"]);
    git(repo, ["mv", "r", "r2"]);
    git(repo, ["rm", "-q", "d"]);
    writeFileSync(join(repo, "p"), "staged\n");
    git(repo, ["add", "p"]);
    writeFileSync(join(repo, "p"), "worktree\n");
    writeFileSync(join(repo, "f1"), "changed\n");
    writeFileSync(join(repo, "s"), "changed\n");
    writeFileSync(join(repo, "u"), "u\n");
    return repo;
  };
  const status = (repo: string) => git(repo, ["status", "--porcelain"]).trimEnd().split("\n");

  it("没选的已暂存改动不进 stash，暂存区原样留着", async () => {
    const repo = scene();
    const before = status(repo);
    await stashPaths.execute(cli, repo, ["s", "u"]);

    const stashed = git(repo, ["diff", "--name-only", "stash@{0}^1", "stash@{0}"]).trim();
    expect(stashed).toBe("s");
    expect(git(repo, ["ls-tree", "-r", "--name-only", "stash@{0}^3"]).trim()).toBe("u");
    expect(status(repo)).toEqual(before.filter((line) => line !== " M s" && line !== "?? u"));
    expect(git(repo, ["show", ":p"])).toBe("staged\n");
  });

  it("选中已暂存的删除能存走，不报 pathspec", async () => {
    const repo = scene();
    await stashPaths.execute(cli, repo, ["d"]);
    expect(git(repo, ["diff", "--name-only", "stash@{0}^1", "stash@{0}"]).trim()).toBe("d");
    expect(status(repo)).not.toContain("D  d");
  });

  it("带说明：列表是 On main: 说明，不带则 git 自己生成 WIP", async () => {
    const named = makeTempRepo("stash-paths-message");
    writeFileSync(join(named, "s"), "changed\n");
    await stashPaths.execute(cli, named, ["s"], "wip login");
    expect(git(named, ["stash", "list"]).trim()).toMatch(/On main: wip login$/);

    const wip = makeTempRepo("stash-paths-wip");
    writeFileSync(join(wip, "s"), "changed\n");
    await stashPaths.execute(cli, wip, ["s"]);
    expect(git(wip, ["stash", "list"]).trim()).toMatch(/^stash@\{0\}: WIP on main: /);
  });

  it("stash 失败也还原暂存区", async () => {
    const repo = makeTempRepo("stash-fail-restore");
    git(repo, ["checkout", "-qb", "other"]);
    writeFileSync(join(repo, "f1"), "theirs\n");
    git(repo, ["commit", "-am", "theirs"]);
    git(repo, ["checkout", "-q", "main"]);
    writeFileSync(join(repo, "f1"), "ours\n");
    git(repo, ["commit", "-am", "ours"]);
    try {
      git(repo, ["merge", "--no-commit", "other"]);
    } catch {
      // 留下未合并的 f1，stash 会拒绝
    }
    writeFileSync(join(repo, "keep"), "keep\n");
    git(repo, ["add", "keep"]);
    const before = status(repo);
    await expect(stashPaths.execute(cli, repo, ["f1"])).rejects.toThrow();
    expect(status(repo)).toEqual(before);
  });

  it("路径里的 [] 不当通配符：旁边的文件不进 stash", async () => {
    const repo = makeTempRepo("literal-stash");
    writeFileSync(join(repo, "foo[bar].txt"), "x\n");
    writeFileSync(join(repo, "foob.txt"), "b\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-qm", "files"]);
    writeFileSync(join(repo, "foo[bar].txt"), "xx\n");
    writeFileSync(join(repo, "foob.txt"), "bb\n");
    await stashPaths.execute(cli, repo, ["foo[bar].txt"]);
    expect(git(repo, ["diff", "--name-only", "stash@{0}^1", "stash@{0}"]).trim()).toBe(
      "foo[bar].txt",
    );
    expect(git(repo, ["diff", "--name-only"]).trim()).toBe("foob.txt");
  });
});

describe("applyStashFiles", () => {
  /**
   * stash 里：修改 a、b、x[y]、xy，删除 d，改名 r → r2（已暂存），未跟踪 u、v。存完工作区是干净的。
   * `xy` 和 `x[y]` 并排：路径当通配符时 `x[y]` 会扫到 `xy`。
   */
  const scene = () => {
    const repo = makeTempRepo("apply-stash-files");
    for (const file of ["a", "b", "d", "r", "x[y]", "xy"])
      writeFileSync(join(repo, file), `${file}\n`);
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-qm", "files"]);
    for (const file of ["a", "b", "x[y]", "xy"]) writeFileSync(join(repo, file), "stashed\n");
    git(repo, ["rm", "-q", "d"]);
    git(repo, ["mv", "r", "r2"]);
    writeFileSync(join(repo, "u"), "u\n");
    writeFileSync(join(repo, "v"), "v\n");
    git(repo, ["stash", "push", "-q", "-u"]);
    return { repo, hash: git(repo, ["rev-parse", "stash@{0}"]).trim() };
  };
  const status = (repo: string) => git(repo, ["status", "--porcelain"]).trimEnd().split("\n");
  const read = (repo: string, file: string) => readFileSync(join(repo, file), "utf8");

  it("只取回选中的已跟踪文件，路径里的 [] 不当通配符；stash 保留", async () => {
    const { repo, hash } = scene();
    await applyStashFiles.execute(cli, repo, hash, ["a", "x[y]"], []);
    expect(status(repo)).toEqual([" M a", " M x[y]"]);
    expect(read(repo, "a")).toBe("stashed\n");
    expect(git(repo, ["rev-parse", "stash@{0}"]).trim()).toBe(hash);
    expect(git(repo, ["stash", "list"]).trim().split("\n")).toHaveLength(1);
  });

  it("未跟踪的只取回选中的", async () => {
    const { repo, hash } = scene();
    await applyStashFiles.execute(cli, repo, hash, [], ["u"]);
    expect(status(repo)).toEqual(["?? u"]);
    expect(read(repo, "u")).toBe("u\n");
  });

  it("删除与改名的两头：取回后旧路径没了、新路径在", async () => {
    const { repo, hash } = scene();
    await applyStashFiles.execute(cli, repo, hash, ["d", "r", "r2"], []);
    expect(existsSync(join(repo, "d"))).toBe(false);
    expect(existsSync(join(repo, "r"))).toBe(false);
    expect(read(repo, "r2")).toBe("r\n");
    expect(status(repo)).not.toContain(" M a");
  });

  it("和 HEAD 冲突：报错，冲突留在暂存区，stash 留着", async () => {
    const { repo, hash } = scene();
    writeFileSync(join(repo, "a"), "head\n");
    git(repo, ["commit", "-qam", "head"]);
    await expect(applyStashFiles.execute(cli, repo, hash, ["a", "b"], [])).rejects.toThrow();
    expect(status(repo)).toEqual(["UU a", "M  b"]);
    expect(git(repo, ["rev-parse", "stash@{0}"]).trim()).toBe(hash);
  });

  it("被本地改动挡住：报错，本地改动原样留着", async () => {
    const { repo, hash } = scene();
    writeFileSync(join(repo, "a"), "local\n");
    await expect(applyStashFiles.execute(cli, repo, hash, ["a"], [])).rejects.toThrow(
      /would be overwritten/,
    );
    expect(read(repo, "a")).toBe("local\n");
    expect(status(repo)).toEqual([" M a"]);
  });
});

describe("renameStash", () => {
  it("改说明：hash 不变，这条排到最前", async () => {
    const repo = makeTempRepo("rename-stash");
    writeFileSync(join(repo, "f1"), "older\n");
    git(repo, ["stash", "push", "-q"]);
    writeFileSync(join(repo, "f1"), "newer\n");
    git(repo, ["stash", "push", "-q", "-m", "keep me"]);
    const older = git(repo, ["rev-parse", "stash@{1}"]).trim();
    const newer = git(repo, ["rev-parse", "stash@{0}"]).trim();

    await renameStash.execute(cli, repo, older, "renamed");

    const [first, second] = await getStashes.execute(cli, repo);
    expect(first).toMatchObject({ hash: older, message: "renamed" });
    expect(second).toMatchObject({ hash: newer, message: "On main: keep me" });
  });

  it("已经不在：抛错，列表不动", async () => {
    const repo = makeTempRepo("rename-stash-gone");
    writeFileSync(join(repo, "f1"), "x\n");
    git(repo, ["stash", "push", "-q"]);
    const missing = "0".repeat(40);
    await expect(renameStash.execute(cli, repo, missing, "x")).rejects.toThrow(/no longer exists/);
    expect(git(repo, ["stash", "list"]).trim()).not.toBe("");
  });
});

describe("unstage", () => {
  it("路径里的 [] 不当通配符：旁边已暂存的文件留着", async () => {
    const repo = makeTempRepo("literal-unstage");
    writeFileSync(join(repo, "foo[bar].txt"), "x\n");
    writeFileSync(join(repo, "foob.txt"), "b\n");
    git(repo, ["add", "foo[bar].txt", "foob.txt"]);
    await unstage.execute(cli, repo, ["foo[bar].txt"]);
    expect(git(repo, ["diff", "--cached", "--name-only"]).trim()).toBe("foob.txt");
    expect(git(repo, ["ls-files", "--others", "--exclude-standard"]).trim()).toBe("foo[bar].txt");
  });
});
