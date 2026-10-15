import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupTempRepos, cli, git, makeTempRepo } from "../../../__tests__/support.js";
import { ResetMode, resetTo } from "../reset.js";

afterEach(cleanupTempRepos);

/**
 * 三条提交：`a.txt` 在第 2、3 条里改过。本地改动：`b.txt` 已暂存、`c.txt` 未暂存（两者都不被那两条提交碰）。
 * 返回仓库与第 1 条提交（reset 的目标）。
 */
function scene(name: string): { repo: string; first: string } {
  const repo = makeTempRepo(name);
  const write = (file: string, content: string) => writeFileSync(join(repo, file), content);
  write("a.txt", "1\n");
  write("b.txt", "b\n");
  write("c.txt", "c\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "one"]);
  const first = git(repo, ["rev-parse", "HEAD"]).trim();
  for (const content of ["2\n", "3\n"]) {
    write("a.txt", content);
    git(repo, ["commit", "-qam", content.trim()]);
  }
  write("b.txt", "b local\n");
  git(repo, ["add", "b.txt"]);
  write("c.txt", "c local\n");
  return { repo, first };
}

const status = (repo: string) => git(repo, ["status", "--porcelain"]).trimEnd().split("\n");
const read = (repo: string, file: string) => readFileSync(join(repo, file), "utf8");
const head = (repo: string) => git(repo, ["rev-parse", "HEAD"]).trim();

describe("resetTo", () => {
  it("Soft：只动分支，差异进暂存区，本地改动不动", async () => {
    const { repo, first } = scene("reset-soft");
    await resetTo.execute(cli, repo, ResetMode.Soft, first);
    expect(head(repo)).toBe(first);
    expect(status(repo)).toEqual(["M  a.txt", "M  b.txt", " M c.txt"]);
    expect(read(repo, "a.txt")).toBe("3\n");
  });

  it("Mixed：差异留在工作区、不暂存，原来暂存的也退回", async () => {
    const { repo, first } = scene("reset-mixed");
    await resetTo.execute(cli, repo, ResetMode.Mixed, first);
    expect(head(repo)).toBe(first);
    expect(status(repo)).toEqual([" M a.txt", " M b.txt", " M c.txt"]);
  });

  it("Keep：文件回到那条提交，不相干的本地改动保留", async () => {
    const { repo, first } = scene("reset-keep");
    await resetTo.execute(cli, repo, ResetMode.Keep, first);
    expect(head(repo)).toBe(first);
    expect(read(repo, "a.txt")).toBe("1\n");
    expect(read(repo, "c.txt")).toBe("c local\n");
    expect(read(repo, "b.txt")).toBe("b local\n");
  });

  it("Keep：本地改动保不住时 git 拒绝，什么都不动", async () => {
    const { repo, first } = scene("reset-keep-refused");
    writeFileSync(join(repo, "a.txt"), "a local\n");
    const before = head(repo);
    await expect(resetTo.execute(cli, repo, ResetMode.Keep, first)).rejects.toThrow();
    expect(head(repo)).toBe(before);
    expect(read(repo, "a.txt")).toBe("a local\n");
  });

  it("Hard：全回到那条提交，本地改动丢掉", async () => {
    const { repo, first } = scene("reset-hard");
    await resetTo.execute(cli, repo, ResetMode.Hard, first);
    expect(head(repo)).toBe(first);
    expect(status(repo)).toEqual([""]);
    expect(read(repo, "a.txt")).toBe("1\n");
    expect(read(repo, "c.txt")).toBe("c\n");
  });
});
