import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupTempRepos, cli, git, makeTempRepo } from "../../__tests__/support.js";
import { IgnoreCache } from "../ignoreCache.js";

afterEach(cleanupTempRepos);

function repoWithIgnores(): string {
  const repo = makeTempRepo("igcache");
  writeFileSync(join(repo, ".gitignore"), "*.log\nbuild/\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "add gitignore"]);
  return repo;
}

describe("IgnoreCache：第一次放行，之后命中", () => {
  it("目标场景——日志反复写同一路径，只放行第一次", async () => {
    const repo = repoWithIgnores();
    const cache = new IgnoreCache(cli, repo);

    // 第一次：不认识 → 放行（多刷一次，安全方向）
    expect(cache.shouldIgnore("app.log")).toBe(false);
    expect(cache.hasPending()).toBe(true);

    await cache.resolvePending();

    // 之后：永久命中，零成本挡住
    for (let i = 0; i < 100; i++) {
      expect(cache.shouldIgnore("app.log")).toBe(true);
    }
    // 没有新的待问项——不会再起子进程
    expect(cache.hasPending()).toBe(false);
  });

  it("「否」的答案也要记，否则普通源码文件会被反复问", async () => {
    const repo = repoWithIgnores();
    const cache = new IgnoreCache(cli, repo);

    expect(cache.shouldIgnore("src/main.ts")).toBe(false);
    await cache.resolvePending();

    expect(cache.shouldIgnore("src/main.ts")).toBe(false);
    expect(cache.hasPending()).toBe(false); // ← 关键：没有再次排队
  });
});

describe("IgnoreCache：批量", () => {
  it("一个窗口里攒的多个新路径，一次问完", async () => {
    const repo = repoWithIgnores();
    const cache = new IgnoreCache(cli, repo);

    const paths = Array.from({ length: 200 }, (_, i) => `logs/run-${i}.log`);
    for (const p of paths) expect(cache.shouldIgnore(p)).toBe(false);

    await cache.resolvePending();

    for (const p of paths) expect(cache.shouldIgnore(p)).toBe(true);
  });
});

describe("IgnoreCache：被忽略的目录整个记住", () => {
  it("编译持续往被忽略的目录里写新文件名：问过一次之后不再放行、不再排队", async () => {
    const repo = repoWithIgnores();
    const cache = new IgnoreCache(cli, repo);

    expect(cache.shouldIgnore("build/obj/a.o")).toBe(false);
    await cache.resolvePending();

    // 之后每个窗口都是没见过的文件名
    for (let i = 0; i < 100; i++) {
      expect(cache.shouldIgnore(`build/obj/unit-${i}.o`)).toBe(true);
      expect(cache.shouldIgnore(`build/CMakeFiles/tmp-${i}/x.d`)).toBe(true);
    }
    expect(cache.hasPending()).toBe(false);
  });

  it("目录里有 add -f 跟踪的文件时，git 不认这个目录被忽略，它下面照常通知", async () => {
    const repo = repoWithIgnores();
    mkdirSync(join(repo, "build"));
    writeFileSync(join(repo, "build", "forced.txt"), "v1\n");
    git(repo, ["add", "-f", "build/forced.txt"]);
    git(repo, ["commit", "-qm", "force add"]);

    const cache = new IgnoreCache(cli, repo);
    cache.shouldIgnore("build/a.o");
    cache.shouldIgnore("build/forced.txt");
    await cache.resolvePending();

    expect(cache.shouldIgnore("build/forced.txt")).toBe(false); // ← 不挡
    expect(cache.shouldIgnore("build/a.o")).toBe(true); // 按文件挡
    expect(cache.shouldIgnore("build/b.o")).toBe(false); // 目录没被记成忽略，新文件照常放行
  });
});
