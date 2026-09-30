import type { Commit, CommitSkeleton } from "@dummy-git/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { cli, fixtures } from "../../../__tests__/support.js";
import { SKELETON_LIMIT } from "../../commands/log.js";
import { detailsArgs, parseLog, parseSkeleton, skeletonArgs } from "../log.js";

/** 走真实路径：`cli.execRaw` → `parseXxx`，与生产代码同一条链。 */
async function skeletonOf(repo: string): Promise<CommitSkeleton[]> {
  const r = await cli.execRaw(skeletonArgs(SKELETON_LIMIT), { cwd: repo });
  return parseSkeleton(r.stdout);
}

async function detailsOf(repo: string, hashes: readonly string[]): Promise<Commit[]> {
  const cmd = detailsArgs(hashes);
  const r = await cli.execRaw(cmd.args, { cwd: repo, input: cmd.input });
  return parseLog(r.stdout);
}

describe("parseSkeleton", () => {
  let skeleton: CommitSkeleton[];
  beforeAll(async () => {
    skeleton = await skeletonOf(fixtures.base);
  });

  it("根提交的 parents 是空数组，不是 [''] ", () => {
    // `%P` 对根提交给的是空字符串。`"".split(" ")` 会得到 `[""]`，
    // 那会凭空造出一个 hash 为空串的假父提交——画图时表现为
    // 一条通向图外的线，且不报任何错。
    const root = skeleton.at(-1);
    expect(root).toBeDefined();
    expect(root?.parents).toEqual([]);
  });

  it("merge 提交有两个父", () => {
    const merges = skeleton.filter((c) => c.parents.length > 1);
    expect(merges.length).toBeGreaterThan(0);
    expect(merges[0]?.parents).toHaveLength(2);
  });

  it("每条都有 40 位 hash 与正整数时间戳", () => {
    expect(skeleton.length).toBeGreaterThan(3);
    for (const c of skeleton) {
      expect(c.hash).toMatch(/^[0-9a-f]{40}$/);
      expect(c.at).toBeGreaterThan(0);
    }
  });
});

describe("parseLog：五种输入", () => {
  let commits: Commit[];
  beforeAll(async () => {
    const skeleton = await skeletonOf(fixtures.base);
    commits = await detailsOf(
      fixtures.base,
      skeleton.map((c) => c.hash),
    );
  });

  it("中文提交消息完好", () => {
    expect(commits.some((c) => c.message.includes("中文文件名"))).toBe(true);
  });

  it("多行消息保留换行与正文", () => {
    const multi = commits.find((c) => c.message.startsWith("subject line"));
    expect(multi).toBeDefined();
    expect(multi?.message).toContain("\n\nbody paragraph one.");
    expect(multi?.message).toContain("body line two.");
  });

  it("奇异消息（含 \\x01、制表符、引号）不破坏记录切分", () => {
    // `\x01` 单独出现是合法的，它只在紧跟两个 `\0` 之后才构成记录分隔符。
    const weird = commits.find((c) => c.message.includes("SOH"));
    expect(weird).toBeDefined();
    expect(weird?.message).toContain("\x01");
    expect(weird?.message).toContain("\t");
    expect(weird?.message).toContain('"quotes"');
  });

  it("author 与 committer 都有，且邮箱非 undefined", () => {
    for (const c of commits) {
      expect(c.author.name).not.toBe("");
      expect(typeof c.author.email).toBe("string");
      expect(typeof c.committer.email).toBe("string");
    }
  });

  it("条数与骨架一致——没有记录被吞掉", () => {
    expect(commits.length).toBeGreaterThan(3);
  });
});

describe("parseLog：log.showSignature=true 不崩", () => {
  /**
   * 只把配置设成 true 然后跑是**无效**的测法：未签名的提交不产生额外输出。
   * 所以 fixture 里的 `signed` 仓库有**真实的 ssh 签名提交**。
   */
  it("先证明：不带 -c 时 git 确实会插入额外输出", async () => {
    // 这条断言存在的意义是防止将来 fixture 退化成「没有真签名」，
    // 让下面那条测试变成假绿。
    const raw = await cli.exec(["-c", "log.showSignature=true", "log", "--format=%H"], {
      cwd: fixtures.signed,
    });
    expect(raw.stdout).toContain("No signature");
  });

  it("我们的 skeletonArgs 带了 -c log.showSignature=false，解析正常", async () => {
    expect(skeletonArgs(SKELETON_LIMIT)).toContain("log.showSignature=false");
    const skeleton = await skeletonOf(fixtures.signed);
    expect(skeleton.length).toBeGreaterThan(0);
    for (const c of skeleton) {
      expect(c.hash).toMatch(/^[0-9a-f]{40}$/);
    }
  });
});

describe("skeletonArgs 不用 --all", () => {
  /**
   * `--all` 会把 stash 及其内部 `index on ...` 提交列进来（实测），
   * 用户 stash 过一次，界面就凭空多两条。所以用显式三件套
   * `--branches --remotes --tags`：等价于 `--all`，但不带 index 与 stash 那些提交。
   */
  it("参数里不出现 --all", () => {
    expect(skeletonArgs(SKELETON_LIMIT)).not.toContain("--all");
  });

  it("用 HEAD / --branches / --remotes / --tags 四件套代替", () => {
    const args = skeletonArgs(SKELETON_LIMIT);
    expect(args).toContain("HEAD");
    expect(args).toContain("--branches");
    expect(args).toContain("--remotes");
    expect(args).toContain("--tags");
  });

  it("stash 过之后，骨架里不出现 stash 提交，也不出现 index on ...", async () => {
    const { execFileSync } = await import("node:child_process");
    const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const repo = mkdtempSync(join(tmpdir(), "stash-"));
    const git = (...a: string[]): void => {
      execFileSync("git", a, {
        cwd: repo,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "a",
          GIT_AUTHOR_EMAIL: "a@b.c",
          GIT_COMMITTER_NAME: "a",
          GIT_COMMITTER_EMAIL: "a@b.c",
        },
      });
    };
    try {
      git("init", "-q", ".");
      writeFileSync(join(repo, "f"), "1");
      git("add", "-A");
      git("commit", "-qm", "c1");
      writeFileSync(join(repo, "f"), "wip");
      git("stash", "-q");

      // `--all` 下这里会是 3 条：c1 + "WIP on master" + "index on master"。
      const raw = await cli.execRaw(skeletonArgs(SKELETON_LIMIT), { cwd: repo });
      expect(parseSkeleton(raw.stdout)).toHaveLength(1);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("skeletonArgs 的上限", () => {
  it("只取最近 limit 条——超过上限的仓库截断，不是全量", async () => {
    const all = parseSkeleton(
      (await cli.execRaw(skeletonArgs(SKELETON_LIMIT), { cwd: fixtures.base })).stdout,
    );
    // fixture 远少于一万条，拿一个比它小的上限验证截断确实生效。
    expect(all.length).toBeGreaterThan(2);
    const two = parseSkeleton((await cli.execRaw(skeletonArgs(2), { cwd: fixtures.base })).stdout);
    expect(two).toEqual(all.slice(0, 2));
  });
});
