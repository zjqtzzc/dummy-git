import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupTempRepos, cli, git, makeTempRepo } from "../../../__tests__/support.js";
import { rollback } from "../rollback.js";

afterEach(cleanupTempRepos);

describe("rollback：勾选的已跟踪文件恢复成 HEAD 的样子", () => {
  it("修改（已暂存 + 未暂存）：暂存区与工作区都恢复", async () => {
    const repo = makeTempRepo("rollback-modified");
    writeFileSync(join(repo, "f1"), "staged\n");
    git(repo, ["add", "f1"]);
    writeFileSync(join(repo, "f1"), "unstaged\n");
    await rollback.execute(cli, repo, ["f1"]);
    expect(readFileSync(join(repo, "f1"), "utf8")).toBe("a\n");
    expect(git(repo, ["status", "--porcelain"]).trim()).toBe("");
  });

  it("删除：文件恢复", async () => {
    const repo = makeTempRepo("rollback-deleted");
    rmSync(join(repo, "f1"));
    await rollback.execute(cli, repo, ["f1"]);
    expect(existsSync(join(repo, "f1"))).toBe(true);
    expect(git(repo, ["status", "--porcelain"]).trim()).toBe("");
  });

  it("新增（add 过、HEAD 里没有）：从暂存区去掉，磁盘上的文件也删掉", async () => {
    const repo = makeTempRepo("rollback-added");
    writeFileSync(join(repo, "new.txt"), "new\n");
    git(repo, ["add", "new.txt"]);
    await rollback.execute(cli, repo, ["new.txt"]);
    expect(existsSync(join(repo, "new.txt"))).toBe(false);
    expect(git(repo, ["status", "--porcelain"]).trim()).toBe("");
  });

  it("改名：新旧两个路径都传进来，新路径删掉、旧路径恢复", async () => {
    const repo = makeTempRepo("rollback-rename");
    git(repo, ["mv", "f1", "renamed"]);
    await rollback.execute(cli, repo, ["renamed", "f1"]);
    expect(existsSync(join(repo, "renamed"))).toBe(false);
    expect(existsSync(join(repo, "f1"))).toBe(true);
    expect(git(repo, ["status", "--porcelain"]).trim()).toBe("");
  });

  it("路径里的 [] 不当通配符：旁边的改动还在", async () => {
    const repo = makeTempRepo("literal-rollback");
    writeFileSync(join(repo, "foo[bar].txt"), "x\n");
    writeFileSync(join(repo, "foob.txt"), "b\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-qm", "files"]);
    writeFileSync(join(repo, "foo[bar].txt"), "xx\n");
    writeFileSync(join(repo, "foob.txt"), "bb\n");
    await rollback.execute(cli, repo, ["foo[bar].txt"]);
    expect(readFileSync(join(repo, "foo[bar].txt"), "utf8")).toBe("x\n");
    expect(readFileSync(join(repo, "foob.txt"), "utf8")).toBe("bb\n");
  });
});
