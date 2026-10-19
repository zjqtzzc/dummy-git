import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GitDomain } from "@dummy-git/shared";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanupTempRepos,
  cli,
  git,
  installSlowCommitHook,
  makeTempRepo,
  plainLocation,
} from "../../__tests__/support.js";
import { commit, getRepositoryLocation, getStatus } from "../../git/commands/index.js";
import { GitFailureError } from "../../git/failure.js";
import { Repository, RepositoryState } from "../repository.js";

afterEach(cleanupTempRepos);

/** 收集一个 Repository 发出的所有域通知。 */
function collect(repo: Repository): ReadonlySet<GitDomain>[] {
  const seen: ReadonlySet<GitDomain>[] = [];
  repo.onDidChange((d) => seen.push(d));
  return seen;
}

describe("Repository：跑命令", () => {
  it("run() 是唯一入口，内部自动过队列", async () => {
    const path = makeTempRepo("repo-run");
    const repo = new Repository(plainLocation(path), cli);
    writeFileSync(join(path, "f1"), "changed\n");
    const { changes } = await repo.run(getStatus, path);
    expect(changes.length).toBeGreaterThan(0);
  });

  it("一仓库一队列是结构性的——两个仓库互不等待", async () => {
    // `runCommand(queue, cli, cmd, ...args)` 里 queue 与仓库路径毫无关联，
    // 传一个全局队列进去代码照跑，只是所有仓库开始互等。
    //
    // 队列在构造时内部创建，**构造函数根本不接收队列**——
    // 想传错都没有地方传。这里测的是由此得到的性质，不是私有性本身：
    // TS 的 `private` 只在编译期成立（运行时 Object.keys 照样看得见），
    // 编译期的部分由 tsc 在 `pnpm check` 里保证。
    const a = new Repository(plainLocation(makeTempRepo("repo-a")), cli);
    const b = new Repository(plainLocation(makeTempRepo("repo-b")), cli);
    installSlowCommitHook(a.location.root, 0.3);
    installSlowCommitHook(b.location.root, 0.3);
    // 改已跟踪的 f1（makeTempRepo 建的），不是新文件——
    // `commit --only` 对未跟踪文件不工作（只对未跟踪先 add）。
    writeFileSync(join(a.location.root, "f1"), "changed-a\n");
    writeFileSync(join(b.location.root, "f1"), "changed-b\n");

    const started = Date.now();
    await Promise.all([
      a.run(commit, a.location.root, "on a", ["f1"], []),
      b.run(commit, b.location.root, "on b", ["f1"], []),
    ]);
    // 并行约 300ms；共用一个队列会串成约 600ms
    expect(Date.now() - started).toBeLessThan(550);
  });
});

describe("Repository：NotAGitRepository → Disposed", () => {
  it("仓库被删掉后，状态转为 Disposed", async () => {
    const path = makeTempRepo("repo-gone");
    const repo = new Repository(plainLocation(path), cli);
    expect(repo.state).toBe(RepositoryState.Active);

    // 把 .git 删掉：此后任何命令都会得到 NotAGitRepository
    rmSync(join(path, ".git"), { recursive: true, force: true });

    await expect(repo.run(getRepositoryLocation, path)).rejects.toBeInstanceOf(GitFailureError);
    expect(repo.state).toBe(RepositoryState.Disposed);
  });

  it("Disposed 之后 run() 直接拒绝，不再起 git 进程", async () => {
    const path = makeTempRepo("repo-disposed");
    const repo = new Repository(plainLocation(path), cli);
    rmSync(join(path, ".git"), { recursive: true, force: true });
    await expect(repo.run(getRepositoryLocation, path)).rejects.toThrow();

    // 第二次：错误消息来自我们自己，不是 git
    await expect(repo.run(getRepositoryLocation, path)).rejects.toThrow(/仓库已失效/);
  });

  it("认不出的失败不会误伤——仓库还在就不该 Disposed", async () => {
    const path = makeTempRepo("repo-other-failure");
    const repo = new Repository(plainLocation(path), cli);
    // 分支不存在：exit 1，classifyError 认不出，code 缺席
    await expect(
      repo.run({
        lock: getStatus.lock,
        execute: (c) => c.exec(["checkout", "nosuch"], { cwd: path }),
      }),
    ).resolves.toBeDefined();
    expect(repo.state).toBe(RepositoryState.Active);
  });
});

describe("Repository：域通知", () => {
  it(".git 路径经 classify 映射成域", () => {
    const repo = new Repository(plainLocation(makeTempRepo("repo-domains")), cli);
    const seen = collect(repo);

    repo.notifyGitPath("refs/heads/main");
    repo.notifyGitPath("index");
    repo.flushPending();

    expect(seen).toHaveLength(1); // 聚合成一次
    expect(seen[0]).toEqual(new Set([GitDomain.Refs, GitDomain.Worktree]));
  });

  it("噪声路径不产生任何通知", () => {
    const repo = new Repository(plainLocation(makeTempRepo("repo-noise")), cli);
    const seen = collect(repo);

    for (const p of ["index.lock", "objects/ab/cdef", "fsmonitor--daemon/ipc"]) {
      repo.notifyGitPath(p);
    }
    repo.flushPending();

    expect(seen).toEqual([]);
  });

  it("退订之后那个监听器不再收到，别人照收", () => {
    // 订阅者（面板的 Router）生命周期比仓库短：面板关了要退订，
    // 否则监听器只增不减，关掉的面板还在收广播。
    const repo = new Repository(plainLocation("/r"), cli);
    const gone: ReadonlySet<GitDomain>[] = [];
    const stays: ReadonlySet<GitDomain>[] = [];

    const unsubscribe = repo.onDidChange((d) => void gone.push(d));
    repo.onDidChange((d) => void stays.push(d));

    unsubscribe();
    repo.notifyGitPath("HEAD");
    repo.flushPending();

    expect(gone).toHaveLength(0);
    expect(stays).toHaveLength(1);
    repo.dispose();
  });

  it("dispose 之后不再发通知", () => {
    const repo = new Repository(plainLocation(makeTempRepo("repo-dispose")), cli);
    const seen = collect(repo);
    repo.dispose();
    repo.notifyGitPath("refs/heads/main");
    repo.flushPending();
    expect(seen).toEqual([]);
  });
});

describe("Repository：被 ignore 的文件持续写入 → 0 次通知（验收标准⑤）", () => {
  it("目标场景：日志反复写，第一次之后不再有通知", async () => {
    const path = makeTempRepo("repo-ignore");
    writeFileSync(join(path, ".gitignore"), "*.log\n");
    git(path, ["add", "-A"]);
    git(path, ["commit", "-qm", "add gitignore"]);

    const repo = new Repository(plainLocation(path), cli);
    const seen = collect(repo);

    // 第一次：还不认识这个路径 → 放行（多刷一次，安全方向）
    repo.notifyWorkspacePath("app.log");
    repo.flushPending();
    expect(seen).toHaveLength(1);

    // 等 ignoreCache 问完 git
    await new Promise((r) => setTimeout(r, 200));

    // 之后一百次写入：一次通知都没有
    for (let i = 0; i < 100; i++) repo.notifyWorkspacePath("app.log");
    repo.flushPending();
    expect(seen).toHaveLength(1); // ← 还是 1
  });
});
