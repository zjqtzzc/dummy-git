import { GitDomain, GitErrorCode, MessageKind, ResponseKind } from "@dummy-git/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Client,
  type ClientTransport,
  CommandFailedError,
  report,
  sendReportsTo,
} from "../client.js";

const GEN = "gen-a";

function recorder(): ClientTransport & { readonly sent: unknown[] } {
  const sent: unknown[] = [];
  return { sent, post: (m) => void sent.push(m) };
}

function ok(id: number, value: unknown, generation = GEN): unknown {
  return { kind: MessageKind.Response, generation, id, result: ResponseKind.Ok, value };
}

/** 等一小会儿，确认 Promise 确实**没有**落地。 */
async function stillPending(p: Promise<unknown>): Promise<boolean> {
  let settled = false;
  const mark = (): void => {
    settled = true;
  };
  void p.then(mark, mark);
  await new Promise((r) => setTimeout(r, 10));
  return !settled;
}

describe("Client：请求与回复配对", () => {
  it("start() 发 ready，request() 发带 id 的请求", () => {
    const t = recorder();
    const client = new Client(t, GEN);

    client.start();
    void client.request("getCommitFiles", { repo: "/r", hash: "abc" });

    expect(t.sent[0]).toEqual({ kind: MessageKind.Ready, generation: GEN });
    expect(t.sent[1]).toEqual({
      kind: MessageKind.Request,
      generation: GEN,
      id: 1,
      command: "getCommitFiles",
      params: { repo: "/r", hash: "abc" },
    });
  });

  it("回复按 id 对上，乱序到达也不会配错", async () => {
    // postMessage 不保证「先发的先回」——慢命令先发、快命令后发，回复就是反的。
    // 靠 id 配对，不靠顺序。
    const t = recorder();
    const client = new Client(t, GEN);

    const first = client.request("getHeadBases", { repo: "/r" });
    const second = client.request("getCommitFiles", { repo: "/r", hash: "abc" });

    client.receive(ok(2, [{ status: "added", path: "b.txt" }]));
    client.receive(ok(1, []));

    await expect(second).resolves.toEqual([{ status: "added", path: "b.txt" }]);
    await expect(first).resolves.toEqual([]);
  });

  it("错误响应 reject 成 CommandFailedError，带 code", async () => {
    const t = recorder();
    const client = new Client(t, GEN);
    const pending = client.request("getHeadBases", { repo: "/r" });

    client.receive({
      kind: MessageKind.Response,
      generation: GEN,
      id: 1,
      result: ResponseKind.Error,
      error: { code: GitErrorCode.NotAGitRepository, message: "fatal: not a git repository" },
    });

    await expect(pending).rejects.toBeInstanceOf(CommandFailedError);
    await expect(pending).rejects.toMatchObject({ code: GitErrorCode.NotAGitRepository });
  });

  it("回复落地后把请求从 pending 里摘掉", async () => {
    // 摘掉不是为了「防止 Promise 被 resolve 两次」——那在 JS 里本来就是空操作。
    // **是为了不让 pending 无限增长**：不摘的话每条完成的请求都永远留在表里。
    //
    // 所以不能断言「第二次回复不生效」：Promise 本来就只认第一次，删掉 `pending.delete()` 也照样通过。
    // 看日志：只有真的摘掉了，第二条才会走到「没人在等」那一支。
    const t = recorder();
    const lines: string[] = [];
    const client = new Client(t, GEN, { log: (line) => void lines.push(line) });
    const pending = client.request("getHeadBases", { repo: "/r" });

    client.receive(ok(1, ["first"]));
    await expect(pending).resolves.toEqual(["first"]);

    expect(() => client.receive(ok(1, ["second"]))).not.toThrow();
    expect(lines.some((l) => l.includes("没有在等 id=1"))).toBe(true);
  });
});

describe("Client：代号与校验", () => {
  it("上一代的回复被丢弃，本代的请求仍在等", async () => {
    // 面板重建后 id 从 1 重新开始。不比代号的话，上一代那条 id=1 的回复
    // 会被当成本代 id=1 的答案——串台，而且内容看起来完全合法。
    const t = recorder();
    const client = new Client(t, "gen-new");
    const pending = client.request("getHeadBases", { repo: "/r" });

    client.receive(ok(1, ["来自上一代"], "gen-old"));
    expect(await stillPending(pending)).toBe(true);

    client.receive(ok(1, ["本代"], "gen-new"));
    await expect(pending).resolves.toEqual(["本代"]);
  });

  it("广播事件交给监听者", () => {
    const t = recorder();
    const client = new Client(t, GEN);
    const seen: { repo: string; domains: readonly GitDomain[] }[] = [];
    client.onDomainsChanged((repo, domains) => void seen.push({ repo, domains }));

    client.receive({
      kind: MessageKind.Event,
      generation: GEN,
      event: "domainsChanged",
      payload: { repo: "/r", domains: [GitDomain.Refs, GitDomain.Worktree] },
    });

    expect(seen).toEqual([{ repo: "/r", domains: [GitDomain.Refs, GitDomain.Worktree] }]);
  });

  it.each([
    ["不是对象", 42],
    ["没有代号", { kind: MessageKind.Response, id: 1, result: ResponseKind.Ok, value: [] }],
    [
      "id 不是整数",
      { kind: MessageKind.Response, generation: GEN, id: 1.5, result: ResponseKind.Ok, value: [] },
    ],
    ["result 不认识", { kind: MessageKind.Response, generation: GEN, id: 1, result: "maybe" }],
    [
      "错误里没有 message",
      { kind: MessageKind.Response, generation: GEN, id: 1, result: ResponseKind.Error, error: {} },
    ],
    [
      "错误码不在闭集里",
      {
        kind: MessageKind.Response,
        generation: GEN,
        id: 1,
        result: ResponseKind.Error,
        error: { code: "bogus", message: "x" },
      },
    ],
    ["事件名不认识", { kind: MessageKind.Event, generation: GEN, event: "whatever", payload: {} }],
    [
      "域里混了非法值",
      {
        kind: MessageKind.Event,
        generation: GEN,
        event: "domainsChanged",
        payload: { repo: "/r", domains: ["refs", "bogus"] },
      },
    ],
  ])("丢弃：%s", async (_name, raw) => {
    const t = recorder();
    const client = new Client(t, GEN);
    let events = 0;
    client.onDomainsChanged(() => {
      events += 1;
    });
    const pending = client.request("getHeadBases", { repo: "/r" });

    expect(() => client.receive(raw)).not.toThrow();

    expect(await stillPending(pending)).toBe(true);
    expect(events).toBe(0);
  });
});

describe("report：页面自己的异常送一份给扩展", () => {
  afterEach(() => vi.restoreAllMocks());

  it("自己的异常送去（消息与调用栈）；请求失败不送（扩展侧已经记过）", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const sent: [string, string][] = [];
    sendReportsTo((message, stack) => void sent.push([message, stack]));
    const bug = new Error("boom");
    report(bug);
    report("not an error");
    report(new CommandFailedError("getStatus", "fatal: x"));
    expect(sent).toEqual([
      ["boom", bug.stack ?? ""],
      ["not an error", ""],
    ]);
  });
});
