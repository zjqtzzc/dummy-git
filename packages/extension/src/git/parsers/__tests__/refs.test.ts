import { type Ref, RefKind, UpstreamState } from "@dummy-git/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { cli, fixtures } from "../../../__tests__/support.js";
import { headArgs, parseHead, parseRefs, refsArgs } from "../refs.js";

async function refsOf(repo: string): Promise<Ref[]> {
  const r = await cli.execRaw(refsArgs(), { cwd: repo });
  return parseRefs(r.stdout);
}

async function headOf(repo: string): Promise<Ref> {
  const r = await cli.execRaw(headArgs(), { cwd: repo });
  return parseHead(r.stdout);
}

function localBranch(refs: readonly Ref[], name: string) {
  return refs.find((r) => r.kind === RefKind.LocalBranch && r.name === name);
}

describe("parseRefs：远程与本地不靠斜杠区分", () => {
  let refs: Ref[];
  beforeAll(async () => {
    refs = await refsOf(fixtures.tracking);
  });

  it("远程分支的 remote 与 name 分开存", () => {
    // 留一个 `"origin/main"` 字符串让人事后拆，分不出远程分支与带斜杠的本地分支。
    const remote = refs.find((r) => r.kind === RefKind.RemoteBranch);
    expect(remote).toBeDefined();
    if (remote?.kind !== RefKind.RemoteBranch) throw new Error("unreachable");
    expect(remote.remote).toBe("origin");
    expect(remote.name).not.toContain("origin/");
  });

  it("本地分支不会被归成远程", () => {
    expect(localBranch(refs, "main")).toBeDefined();
    const names = refs
      .filter((r) => r.kind === RefKind.RemoteBranch)
      .map((r) => (r.kind === RefKind.RemoteBranch ? r.name : ""));
    expect(names).not.toContain("local-upstream");
  });
});

describe("parseRefs：上游状态", () => {
  let refs: Ref[];
  beforeAll(async () => {
    refs = await refsOf(fixtures.tracking);
  });

  it("[gone]：上游配置还在但远程分支没了", () => {
    const gone = localBranch(refs, "gone");
    expect(gone?.kind).toBe(RefKind.LocalBranch);
    if (gone?.kind !== RefKind.LocalBranch) throw new Error("unreachable");
    expect(gone.upstream?.state.kind).toBe(UpstreamState.Gone);
  });

  it("gone 与「完全同步」不会混淆", () => {
    // 把 ahead/behind 平铺上来的话，`[gone]` 只能拿 0/0 冒充，
    // 与「完全同步」再也分不开——所以同步状态是 tagged union。
    const synced = localBranch(refs, "synced");
    if (synced?.kind !== RefKind.LocalBranch) throw new Error("unreachable");
    expect(synced.upstream?.state.kind).toBe(UpstreamState.Tracking);
    if (synced.upstream?.state.kind !== UpstreamState.Tracking) throw new Error("unreachable");
    expect(synced.upstream.state.ahead).toBe(0);
    expect(synced.upstream.state.behind).toBe(0);
  });

  it("ahead / behind / diverged 各自正确", () => {
    for (const [name, ahead, behind] of [
      ["main", 2, 0],
      ["behind", 0, 1],
      ["diverged", 1, 1],
    ] as const) {
      const b = localBranch(refs, name);
      if (b?.kind !== RefKind.LocalBranch) throw new Error(`missing ${name}`);
      if (b.upstream?.state.kind !== UpstreamState.Tracking) throw new Error(`no upstream ${name}`);
      expect([name, b.upstream.state.ahead, b.upstream.state.behind]).toEqual([
        name,
        ahead,
        behind,
      ]);
    }
  });

  it("没配上游的分支：upstream 字段缺席", () => {
    const none = localBranch(refs, "no-upstream");
    if (none?.kind !== RefKind.LocalBranch) throw new Error("unreachable");
    expect(none.upstream).toBeUndefined();
  });

  it("跟踪**本地**分支也算有上游", () => {
    // `git branch --set-upstream-to=main feature` 是合法配置，
    // 此时 `%(upstream)` 是 `refs/heads/main` 而不是 `refs/remotes/…`。
    // 按 `refs/remotes/` 前缀判断的话，不匹配就当「无上游」——
    // 连 ahead 一起丢掉，且不报任何错。
    const b = localBranch(refs, "local-upstream");
    if (b?.kind !== RefKind.LocalBranch) throw new Error("unreachable");
    expect(b.upstream).toBeDefined();
    expect(b.upstream?.remote).toBe(".");
    expect(b.upstream?.name).toBe("main");
    if (b.upstream?.state.kind !== UpstreamState.Tracking) throw new Error("unreachable");
    expect(b.upstream.state.ahead).toBe(1);
  });
});

describe("parseRefs：tag", () => {
  it("附注 tag 用剥壳后的 hash，能对上提交", async () => {
    // `%(objectname)` 给的是 tag 对象自己的 hash——拿它去和提交列表
    // 对照会一条都匹配不上。必须用 `%(*objectname)`。
    const refs = await refsOf(fixtures.base);
    const tags = refs.filter((r) => r.kind === RefKind.Tag);
    expect(tags.length).toBeGreaterThan(0);

    const log = await cli.exec(["log", "--all", "--format=%H"], { cwd: fixtures.base });
    const commitHashes = new Set(log.stdout.split("\n").filter(Boolean));
    for (const t of tags) {
      expect(commitHashes.has(t.target)).toBe(true);
    }
  });

  it("附注与轻量 tag 能区分", async () => {
    const refs = await refsOf(fixtures.base);
    const tags = refs.filter((r) => r.kind === RefKind.Tag);
    const annotated = tags.map((t) => (t.kind === RefKind.Tag ? t.annotated : false));
    expect(annotated).toContain(true);
    expect(annotated).toContain(false);
  });
});

describe("parseHead", () => {
  it("正常分支：带 branch", async () => {
    const head = await headOf(fixtures.base);
    expect(head.kind).toBe(RefKind.Head);
    if (head.kind !== RefKind.Head) throw new Error("unreachable");
    expect(head.branch).toBeDefined();
  });

  it("detached：branch 缺席（而不是 isDetached: true）", async () => {
    // 用 branch 的有无表示 detached，是为了让
    // `{ isDetached: true, branch: "main" }` 这种自相矛盾的值写不出来。
    const head = await headOf(fixtures.detached);
    if (head.kind !== RefKind.Head) throw new Error("unreachable");
    expect(head.branch).toBeUndefined();
    expect(head.target).toMatch(/^[0-9a-f]{40}$/);
  });
});
