import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupTempRepos, cli, git, makeTempRepo } from "../../../__tests__/support.js";
import { GitFailureError } from "../../failure.js";
import { checkIgnore } from "../checkIgnore.js";

afterEach(cleanupTempRepos);

/** 建一个带 .gitignore 的仓库：忽略 *.log 与 build/。 */
function repoWithIgnores(): string {
  const repo = makeTempRepo("ignore");
  writeFileSync(join(repo, ".gitignore"), "*.log\nbuild/\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "add gitignore"]);
  return repo;
}

describe("checkIgnore：退出码是数据", () => {
  it("有路径被忽略（exit 0）→ 只返回被忽略的那些", async () => {
    const repo = repoWithIgnores();
    const ignored = await checkIgnore.execute(cli, repo, ["a.log", "keep.txt", "build/x.o"]);
    expect(ignored).toEqual(new Set(["a.log", "build/x.o"]));
  });

  it("一个都没被忽略（exit 1）→ 空集合，不抛", async () => {
    // git 在这种情况返回 1。它是正常答案，不是失败——
    // 走 run()/runRaw() 的话会被「失败即抛」当成错误。
    const repo = repoWithIgnores();
    const ignored = await checkIgnore.execute(cli, repo, ["keep.txt", "other.txt"]);
    expect(ignored).toEqual(new Set());
  });

  it("空输入 → 空集合，且不起子进程", async () => {
    const repo = repoWithIgnores();
    expect(await checkIgnore.execute(cli, repo, [])).toEqual(new Set());
  });

  it("真出错（不是仓库）→ 抛 GitFailureError", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "not-a-repo-"));
    await expect(checkIgnore.execute(cli, dir, ["a.log"])).rejects.toBeInstanceOf(GitFailureError);
  });
});

describe("checkIgnore：为什么问 git 而不自己做模式匹配", () => {
  it("被 add -f 强制跟踪的 ignored 文件 → **不算忽略**", async () => {
    // 纯模式匹配等价于 --no-index，会把这个文件判成忽略，于是用户对它的改动永远不显示。
    // git 自己的 check-ignore 默认认 index，结构上不会有这个问题。
    const repo = repoWithIgnores();
    writeFileSync(join(repo, "forced.log"), "v1\n");
    git(repo, ["add", "-f", "forced.log"]);
    git(repo, ["commit", "-qm", "force add"]);

    const ignored = await checkIgnore.execute(cli, repo, ["forced.log", "other.log"]);
    expect(ignored.has("forced.log")).toBe(false);
    // 对照组：同样匹配 *.log 但没被跟踪的，照常算忽略
    expect(ignored.has("other.log")).toBe(true);
  });

  it("嵌套 .gitignore 也认（问 git，不用自己找各级 .gitignore）", async () => {
    const repo = repoWithIgnores();
    mkdirSync(join(repo, "sub"), { recursive: true });
    writeFileSync(join(repo, "sub", ".gitignore"), "*.tmp\n");
    const ignored = await checkIgnore.execute(cli, repo, ["sub/a.tmp", "a.tmp"]);
    expect(ignored.has("sub/a.tmp")).toBe(true);
    // 根目录没有 *.tmp 规则，子目录的规则不该外溢
    expect(ignored.has("a.tmp")).toBe(false);
  });

  it("否定规则 ! 也认", async () => {
    const repo = makeTempRepo("negation");
    writeFileSync(join(repo, ".gitignore"), "*.log\n!keep.log\n");
    const ignored = await checkIgnore.execute(cli, repo, ["a.log", "keep.log"]);
    expect(ignored.has("a.log")).toBe(true);
    expect(ignored.has("keep.log")).toBe(false);
  });
});
