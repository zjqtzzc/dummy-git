import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanupTempRepos,
  cli,
  fixtures,
  git,
  installSlowCommitHook,
  makeTempRepo,
} from "../../__tests__/support.js";
import { GitCli } from "../cli.js";
import { GitCancelledError, type GitLogger } from "../types.js";

afterEach(cleanupTempRepos);

describe("退出码是数据，不是异常", () => {
  it("rev-parse --verify 一个不存在的 ref → 返回 128，不抛", async () => {
    // 默认抛的代价：vscode `git.ts:1503/1852/1877` 三处死代码——
    // `if (result.exitCode) return []` 位于必定抛出的路径之后，永不可达。
    const r = await cli.exec(["rev-parse", "--verify", "nosuchref"], { cwd: fixtures.base });
    expect(r.exitCode).toBe(128);
    expect(r.stderr).not.toBe("");
  });

  it("diff --quiet 有差异 → 返回 1（这是「有差异」，不是失败）", async () => {
    const r = await cli.exec(["diff", "--quiet"], { cwd: fixtures.base });
    expect(r.exitCode).toBe(1);
  });
});

describe("字节在下，文本在上", () => {
  it("execRaw 给 Buffer，exec 给解码后的字符串", async () => {
    const raw = await cli.execRaw(["log", "-1", "--format=%H"], { cwd: fixtures.base });
    const txt = await cli.exec(["log", "-1", "--format=%H"], { cwd: fixtures.base });
    expect(Buffer.isBuffer(raw.stdout)).toBe(true);
    expect(raw.stdout.toString("utf8")).toBe(txt.stdout);
  });

  it("中文文件名原样输出，不出现 \\344 八进制转义", async () => {
    // 靠 FORCED_ENV 里的 GIT_CONFIG_PARAMETERS='core.quotepath=false'
    const r = await cli.exec(["ls-files"], { cwd: fixtures.base });
    expect(r.stdout).toMatch(/[一-龥]/);
    expect(r.stdout).not.toMatch(/\\[0-3][0-7][0-7]/);
  });
});

describe("stdin", () => {
  it("传 input 时写入 stdin", async () => {
    const r = await cli.exec(["hash-object", "--stdin"], {
      cwd: fixtures.base,
      input: "hello\n",
    });
    expect(r.exitCode).toBe(0);
    // 已知内容的 blob hash，稳定值
    expect(r.stdout.trim()).toBe("ce013625030ba8dba906f756967f9e9ca394464a");
  });

  it("git 没读完 stdin 就退出：得到它的退出码，不冒出未捕获的 EPIPE", async () => {
    // 不是仓库 → git 一启动就失败退出，根本不读 stdin。1 MB 远大于管道缓冲（64 KB），
    // 它退出时我们一定还在写，写端必然 EPIPE。以前 stdin 上没挂 error 监听，
    // 这个 EPIPE 成了未捕获异常（偶发于 checkIgnore 的「不是仓库」测试，靠时序）。
    const dir = mkdtempSync(join(tmpdir(), "dummygit-epipe-"));
    try {
      const r = await cli.exec(["check-ignore", "-z", "--stdin"], {
        cwd: dir,
        input: "x\0".repeat(512 * 1024),
      });
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr).toMatch(/not a git repository/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("不传 input 时 stdin 立刻 EOF（不挂住）", async () => {
    // 已知代价：git 分不出 /dev/null 和「立刻关闭的管道」，
    // 所以 hash-object 会返回空内容的合法哈希。这里断言的是**不挂住**。
    const r = await cli.exec(["hash-object", "--stdin"], { cwd: fixtures.base });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
  });
});

describe("取消", () => {
  it("运行中 abort → 杀掉进程并抛 GitCancelledError", async () => {
    // ⚠️ 必须保证进程**真的在跑**时才 abort。
    // 起进程前就 abort 走的是另一条分支（见下一条），两者抛同样的错，
    // 不撑开窗口的话这条测试会安静地变成那条的重复。
    const repo = makeTempRepo("cancel");
    installSlowCommitHook(repo, 3);
    writeFileSync(join(repo, "f1"), "changed\n");

    const controller = new AbortController();
    const started = Date.now();
    const promise = cli.exec(["commit", "-am", "slow"], {
      cwd: repo,
      signal: controller.signal,
    });
    await new Promise((r) => setTimeout(r, 300));
    controller.abort();

    await expect(promise).rejects.toBeInstanceOf(GitCancelledError);
    // 钩子要睡 3 秒；提前返回说明进程确实被杀了，而不是跑完了
    expect(Date.now() - started).toBeLessThan(2500);
    // 而且提交没有落盘
    expect(git(repo, ["log", "--format=%s"]).trim()).toBe("init");
  });

  it("传入已经 abort 的 signal → 进程根本不起", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      cli.exec(["log"], { cwd: fixtures.base, signal: controller.signal }),
    ).rejects.toBeInstanceOf(GitCancelledError);
  });
});

describe("进程起不来时 reject，不伪造退出码", () => {
  it("git 路径不存在", async () => {
    // git-graph 的做法是伪造 `code: -1`，那会让「命令失败」和
    // 「git 装都没装」变成同一种结果。
    const broken = new GitCli("/nonexistent/git-binary");
    await expect(broken.exec(["log"], { cwd: fixtures.base })).rejects.toThrow();
  });
});

describe("日志", () => {
  it("一条命令只记一次", async () => {
    // M2 审阅时抓到的 bug：成功路径记了两遍。
    const lines: string[] = [];
    const logger: GitLogger = { log: (l) => lines.push(l) };
    const logged = new GitCli("git", logger);
    await logged.exec(["log", "-1", "--format=%H"], { cwd: fixtures.base });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("log");
  });

  it("失败的命令也只记一次", async () => {
    const lines: string[] = [];
    const logged = new GitCli("git", { log: (l) => lines.push(l) });
    await logged.exec(["rev-parse", "--verify", "nosuchref"], { cwd: fixtures.base });
    expect(lines).toHaveLength(1);
  });
});

describe("GIT_TERMINAL_PROMPT=0：认证需求时快速失败而不是挂住", () => {
  it("对不存在的远程 fetch 会在超时内退出", async () => {
    const repo = makeTempRepo("noprompt");
    git(repo, ["remote", "add", "origin", "https://127.0.0.1:1/nonexistent.git"]);
    const start = Date.now();
    const r = await cli.exec(["fetch", "origin"], { cwd: repo });
    expect(r.exitCode).not.toBe(0);
    // 挂住的表现是这里永远不返回；给足余量，只要不是「永不返回」即可
    expect(Date.now() - start).toBeLessThan(15_000);
  });
});
