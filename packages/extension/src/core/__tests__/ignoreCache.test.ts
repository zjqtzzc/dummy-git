import { writeFileSync } from "node:fs";
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

    // 模拟一次构建：几百个随机文件名落在同一个窗口
    const paths = Array.from({ length: 200 }, (_, i) => `build/chunk-${i}.js`);
    for (const p of paths) expect(cache.shouldIgnore(p)).toBe(false);

    await cache.resolvePending();

    for (const p of paths) expect(cache.shouldIgnore(p)).toBe(true);
    expect(cache.size).toBe(200);
  });
});

describe("IgnoreCache：invalidate 让规则变化生效", () => {
  it("改了 .gitignore 之后，旧答案作废", async () => {
    const repo = repoWithIgnores();
    const cache = new IgnoreCache(cli, repo);

    cache.shouldIgnore("notes.txt");
    await cache.resolvePending();
    expect(cache.shouldIgnore("notes.txt")).toBe(false); // 此刻不被忽略

    // 用户把它加进 .gitignore
    writeFileSync(join(repo, ".gitignore"), "*.log\nbuild/\nnotes.txt\n");
    cache.invalidate();

    // 作废后重新问，答案变了
    expect(cache.shouldIgnore("notes.txt")).toBe(false); // 第一次又是放行
    await cache.resolvePending();
    expect(cache.shouldIgnore("notes.txt")).toBe(true);
  });
});

describe("IgnoreCache：GitLens 那个洞在这里结构上不存在", () => {
  it("add -f 强制跟踪的 ignored 文件，改动**不会**被挡", async () => {
    // 纯模式匹配的库会把它判成忽略 → 用户对它的改动永远不显示。
    // 我们问的是 git，而 check-ignore 默认认 index。
    const repo = repoWithIgnores();
    writeFileSync(join(repo, "forced.log"), "v1\n");
    git(repo, ["add", "-f", "forced.log"]);
    git(repo, ["commit", "-qm", "force add"]);

    const cache = new IgnoreCache(cli, repo);
    cache.shouldIgnore("forced.log");
    cache.shouldIgnore("other.log");
    await cache.resolvePending();

    expect(cache.shouldIgnore("forced.log")).toBe(false); // ← 不挡
    expect(cache.shouldIgnore("other.log")).toBe(true); // ← 对照组，照常挡
  });
});
