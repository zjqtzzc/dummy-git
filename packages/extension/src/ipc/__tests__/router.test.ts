import {
  type Commit,
  type CommitFileChange,
  type CommitSkeleton,
  GitDomain,
  GitErrorCode,
  MessageKind,
  type OutboundMessage,
  type Ref,
  ResponseKind,
  type StatusSnapshot,
} from "@dummy-git/shared";
import { describe, expect, it, vi } from "vitest";
import { GitFailureError } from "../../git/failure.js";
import { defineHandlers, type HandlerMap, Router, type Transport } from "../router.js";

const GEN = "gen-1";

/** 收下所有发出去的消息，供断言。 */
function recorder(): Transport & { readonly sent: OutboundMessage[] } {
  const sent: OutboundMessage[] = [];
  return { sent, post: (m) => void sent.push(m) };
}

function handlersWith(overrides: Partial<HandlerMap> = {}): HandlerMap {
  return defineHandlers({
    getRepositories: async (): Promise<readonly string[]> => [],
    getSkeleton: async (): Promise<CommitSkeleton[]> => [],
    getCommitDetails: async (): Promise<Commit[]> => [],
    getRefs: async (): Promise<Ref[]> => [],
    openDiff: async (): Promise<null> => null,
    getCommitFiles: async (): Promise<CommitFileChange[]> => [],
    getStatus: async (): Promise<StatusSnapshot> => ({ changes: [] }),
    commit: async (): Promise<null> => null,
    amend: async (): Promise<null> => null,
    rollback: async (): Promise<null> => null,
    fetch: async (): Promise<null> => null,
    pull: async (): Promise<null> => null,
    push: async (): Promise<null> => null,
    checkout: async (): Promise<null> => null,
    checkoutRemote: async (): Promise<null> => null,
    newBranch: async (): Promise<null> => null,
    ...overrides,
  });
}

function ready(router: Router, generation = GEN): void {
  router.receive({ kind: MessageKind.Ready, generation });
}

function request(id: number, generation = GEN): unknown {
  return {
    kind: MessageKind.Request,
    generation,
    id,
    command: "getCommitFiles",
    params: { repo: "/r", hash: "abc" },
  };
}

describe("Router：分发与响应", () => {
  it("握手后的请求会跑 handler，并回一条 Ok", async () => {
    const t = recorder();
    const files: CommitFileChange[] = [];
    const router = new Router(t, handlersWith({ getCommitFiles: async () => files }));

    ready(router);
    router.receive(request(1));
    await vi.waitFor(() => expect(t.sent).toHaveLength(1));

    expect(t.sent[0]).toEqual({
      kind: MessageKind.Response,
      generation: GEN,
      id: 1,
      result: ResponseKind.Ok,
      value: files,
    });
  });

  it("handler 抛 GitFailureError → 错误响应带 code", async () => {
    const t = recorder();
    const router = new Router(
      t,
      handlersWith({
        getCommitFiles: async () => {
          throw new GitFailureError(
            ["log"],
            128,
            "fatal: not a git repository",
            GitErrorCode.NotAGitRepository,
          );
        },
      }),
    );

    ready(router);
    router.receive(request(7));
    await vi.waitFor(() => expect(t.sent).toHaveLength(1));

    const sent = t.sent[0];
    expect(sent).toMatchObject({
      id: 7,
      result: ResponseKind.Error,
      error: { code: GitErrorCode.NotAGitRepository, message: "fatal: not a git repository" },
    });
  });

  it("handler 抛普通错误也必须回一条——否则调用方永远等下去", async () => {
    // 协议层没有超时（写命令排队可能很久，超时会变成对用户撒谎），
    // 代价就是响应绝不能丢。我们自己的 bug 也要回。
    const t = recorder();
    const router = new Router(
      t,
      handlersWith({
        getCommitFiles: async () => {
          throw new TypeError("我们自己的 bug");
        },
      }),
    );

    ready(router);
    router.receive(request(2));
    await vi.waitFor(() => expect(t.sent).toHaveLength(1));

    expect(t.sent[0]).toMatchObject({
      result: ResponseKind.Error,
      error: { message: "我们自己的 bug" },
    });
    // 认不出的错误没有 code——不设 Unknown 成员，理由见 shared/error.ts。
    expect(t.sent[0]).not.toHaveProperty("error.code");
  });

  it("handler 失败交给错误关口——Router 是三个关口之一", async () => {
    const t = recorder();
    const reported: unknown[] = [];
    const bug = new TypeError("我们自己的 bug");
    const router = new Router(
      t,
      handlersWith({
        getCommitFiles: async () => {
          throw bug;
        },
      }),
      { log: () => {}, report: (error) => reported.push(error) },
    );

    ready(router);
    router.receive(request(1));
    await vi.waitFor(() => expect(t.sent).toHaveLength(1));
    expect(reported).toEqual([bug]);
  });

  it("post 第一次就抛，也不会回第二次（恰好一次）", async () => {
    // 面板刚被销毁时 post 会抛。若 catch 里再回一次，
    // 就成了「一条请求两条响应」——webview 侧按 id 配对，第二条会砸掉别的状态。
    let calls = 0;
    const t: Transport = {
      post: () => {
        calls += 1;
        throw new Error("面板没了");
      },
    };
    const router = new Router(t, handlersWith());

    ready(router);
    router.receive(request(3));
    await vi.waitFor(() => expect(calls).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 10));

    expect(calls).toBe(1);
  });
});

describe("Router：边界校验（CLAUDE.md C.1）", () => {
  it("握手前的请求被丢弃，handler 不会跑", async () => {
    const t = recorder();
    let ran = false;
    const router = new Router(
      t,
      handlersWith({
        getCommitFiles: async () => {
          ran = true;
          return [];
        },
      }),
    );

    router.receive(request(1));
    await new Promise((r) => setTimeout(r, 10));

    expect(ran).toBe(false);
    expect(t.sent).toHaveLength(0);
  });

  it("上一代 webview 的残留请求被丢弃", async () => {
    // webview 重建后 id 从 1 重新开始。若不按代号丢弃，
    // 上一代跑完的 id=1 会被新一代当成自己那条 id=1 的回复——串台，且内容看起来合法。
    const t = recorder();
    let ran = false;
    const router = new Router(
      t,
      handlersWith({
        getCommitFiles: async () => {
          ran = true;
          return [];
        },
      }),
    );

    ready(router, "gen-2");
    router.receive(request(1, "gen-1"));
    await new Promise((r) => setTimeout(r, 10));

    expect(ran).toBe(false);
    expect(t.sent).toHaveLength(0);
  });

  it.each([
    ["不是对象", 42],
    [
      "没有代号",
      { kind: MessageKind.Request, id: 1, command: "getSkeleton", params: { repo: "/r" } },
    ],
    [
      "id 不是整数",
      {
        kind: MessageKind.Request,
        generation: GEN,
        id: 1.5,
        command: "getSkeleton",
        params: { repo: "/r" },
      },
    ],
  ])("丢弃：%s", async (_name, raw) => {
    const t = recorder();
    let ran = false;
    const router = new Router(
      t,
      defineHandlers({
        getRepositories: async () => {
          ran = true;
          return [];
        },
        getSkeleton: async () => {
          ran = true;
          return [];
        },
        getCommitDetails: async () => {
          ran = true;
          return [];
        },
        getRefs: async () => {
          ran = true;
          return [];
        },
        openDiff: async () => {
          ran = true;
          return null;
        },
        getCommitFiles: async () => {
          ran = true;
          return [];
        },
        getStatus: async () => {
          ran = true;
          return { changes: [] };
        },
        commit: async () => {
          ran = true;
          return null;
        },
        amend: async () => {
          ran = true;
          return null;
        },
        rollback: async () => {
          ran = true;
          return null;
        },
        fetch: async () => {
          ran = true;
          return null;
        },
        pull: async () => {
          ran = true;
          return null;
        },
        push: async () => {
          ran = true;
          return null;
        },
        checkout: async () => {
          ran = true;
          return null;
        },
        checkoutRemote: async () => {
          ran = true;
          return null;
        },
        newBranch: async () => {
          ran = true;
          return null;
        },
      }),
    );

    ready(router);
    expect(() => router.receive(raw)).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));

    expect(ran).toBe(false);
    expect(t.sent).toHaveLength(0);
  });
});

describe("Router：读得出 id 的不合法请求回一个错误，不让前端一直等", () => {
  it.each([
    ["命令名不在协议表里（webview 比扩展宿主新）", "cherryPick", {}],
    ["参数缺字段", "getCommitFiles", { repo: "/r" }],
    ["参数类型不对", "getCommitDetails", { repo: "/r", hashes: [1, 2] }],
  ])("%s", async (_name, command, params) => {
    const t = recorder();
    const reported: unknown[] = [];
    const router = new Router(t, handlersWith(), {
      log: () => {},
      report: (error) => void reported.push(error),
    });
    ready(router);
    router.receive({ kind: MessageKind.Request, generation: GEN, id: 7, command, params });

    expect(t.sent).toEqual([
      expect.objectContaining({ kind: MessageKind.Response, id: 7, result: ResponseKind.Error }),
    ]);
    expect(reported).toHaveLength(1);
  });

  it("代号不符的照样丢：上一代的请求，回了也没人要", () => {
    const t = recorder();
    const router = new Router(t, handlersWith());
    ready(router, "gen-2");
    router.receive({
      kind: MessageKind.Request,
      generation: "gen-1",
      id: 7,
      command: "x",
      params: {},
    });
    expect(t.sent).toHaveLength(0);
  });
});

describe("Router：握手与换代", () => {
  it("握手之前不广播——那一条会静静地丢掉，不报任何错", () => {
    // webview 是一张网页，脚本挂上监听之前 postMessage 发过去的东西没人收。
    const t = recorder();
    const router = new Router(t, handlersWith());

    router.broadcast("/r", [GitDomain.Refs]);

    expect(t.sent).toHaveLength(0);
  });

  it("握手之后才广播，且带当前代号", () => {
    const t = recorder();
    const router = new Router(t, handlersWith());

    ready(router);
    router.broadcast("/r", [GitDomain.Refs, GitDomain.Worktree]);

    expect(t.sent).toEqual([
      {
        kind: MessageKind.Event,
        generation: GEN,
        event: "domainsChanged",
        payload: { repo: "/r", domains: [GitDomain.Refs, GitDomain.Worktree] },
      },
    ]);
  });

  it("命令跑到一半面板换了代，那条回复不发出去", async () => {
    // 新一代的 id 也是从 1 开始。把上一代 id=1 的回复发过去就是串台，
    // 而且内容看起来完全合法。webview 侧也拦一道，这里是同一判断的另一半。
    let release: () => void = () => {};
    const blocked = new Promise<void>((r) => {
      release = r;
    });

    const t = recorder();
    const router = new Router(
      t,
      handlersWith({
        getCommitFiles: async () => {
          await blocked;
          return [];
        },
      }),
    );

    ready(router, "gen-old");
    router.receive(request(1, "gen-old"));
    // 命令还堵着的时候面板重建了
    ready(router, "gen-new");
    release();
    await new Promise((r) => setTimeout(r, 20));

    expect(t.sent).toHaveLength(0);
  });

  it("换代之后，新一代自己的请求照常回复", async () => {
    const t = recorder();
    const router = new Router(t, handlersWith());

    ready(router, "gen-old");
    ready(router, "gen-new");
    router.receive(request(1, "gen-new"));
    await vi.waitFor(() => expect(t.sent).toHaveLength(1));

    expect(t.sent[0]).toMatchObject({ generation: "gen-new", id: 1, result: ResponseKind.Ok });
  });
});
