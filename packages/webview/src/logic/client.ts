/**
 * webview 这一侧：发请求、等回复、收广播。
 *
 * ## 为什么需要「等回复」这套东西
 *
 * `postMessage` **没有「回复」这个概念**——它只是往对面扔一段数据，不返回任何东西。
 * 想要「问一句、等一个答案」，就得自己给每条请求编号，把编号记在一张表里，
 * 对面把编号原样带回来时再对上。这就是下面的 `pending`。
 *
 * ## 代号（generation）
 *
 * webview 会被销毁重建（面板隐藏再显示、VSCode 重载），新一代的 `id` 从 1 重新开始。
 * 若扩展侧还有上一代的请求在跑，它完成时发出的 `{ id: 1, … }` 会被新一代
 * **当成自己那条 id=1 的回复**——串台，而且内容看起来完全合法。
 *
 * 所以每一代启动时生成一个代号，双向都带上，对不上的一律丢弃。
 *
 * ## id 不做溢出处理
 *
 * `Number.MAX_SAFE_INTEGER` 是 9,007,199,254,740,991；即使每秒 1000 个请求不间断，
 * 也要 28.6 万年才耗尽（实测计算），且每一代归零。
 * 为它加环绕逻辑 = 给不存在的问题造答案。
 */

import type { CommandName, CommandParams, CommandResult, GitDomain } from "@dummy-git/shared";
import { MessageKind } from "@dummy-git/shared";
import { type Incoming, parseIncoming, trustValue } from "./protocol.guards.js";

/**
 * 消息怎么发出去。注入式——`Client` 因此不碰 `acquireVsCodeApi`，能在纯 node 下测。
 * 与扩展侧 `Router` 的 `Transport` 是同一手法。
 */
export interface ClientTransport {
  readonly post: (message: unknown) => void;
}

export interface ClientLogger {
  readonly log: (line: string) => void;
}

const NOOP_LOGGER: ClientLogger = { log: () => {} };

/** 命令失败。`code` 认不出时缺席——git 的错误文案是开放集（见 `shared/error.ts`）。 */
export class CommandFailedError extends Error {
  constructor(
    readonly command: CommandName,
    message: string,
    readonly code?: string,
  ) {
    super(`${command} 失败：${message}`);
    this.name = "CommandFailedError";
  }
}

/** 只是给 `pending` 的签名取个名字。 */
type ResponseIncoming = Extract<Incoming, { kind: MessageKind.Response }>;

export type DomainsListener = (repo: string, domains: readonly GitDomain[]) => void;

export class Client {
  private nextId = 1;
  /**
   * 在等回复的请求。
   *
   * 存的是 `settle` 而不是 `resolve`/`reject` 两个函数：
   * 每条请求的返回类型不同，把它们塞进同一张表就需要类型断言。
   * `settle` 在 `request<K>()` 里就地创建，那时 `K` 是已知的，
   * 闭包把类型关在里面，表上只剩一个统一的签名——**不需要断言**。
   */
  private readonly pending = new Map<
    number,
    { readonly settle: (message: ResponseIncoming) => void }
  >();
  private readonly listeners = new Set<DomainsListener>();

  constructor(
    private readonly transport: ClientTransport,
    /** 这一代的代号。由调用方生成（`crypto.randomUUID()`），因为它也要写进 ready。 */
    readonly generation: string,
    private readonly logger: ClientLogger = NOOP_LOGGER,
  ) {}

  /**
   * 告诉对面「我准备好了」。
   *
   * **必须在挂好消息监听之后调用。** 这正是握手要解决的问题：
   * 扩展侧在收到它之前一个字节都不发，于是「消息发早了、页面还没监听、悄悄丢了」
   * 不可能发生。旧仓库在这里用的是 `setTimeout(…, 200)`——那不是机制，是赌博。
   */
  start(): void {
    this.transport.post({ kind: MessageKind.Ready, generation: this.generation });
  }

  /** 发一条请求，等回复。 */
  request<K extends CommandName>(command: K, params: CommandParams<K>): Promise<CommandResult<K>> {
    const id = this.nextId++;
    return new Promise<CommandResult<K>>((resolve, reject) => {
      this.pending.set(id, {
        settle: (message) => {
          if (message.ok) {
            // `value` 这一层没验过（见 `protocol.guards.ts` 的取舍）。
            // 它是哪条命令的返回值只有这里知道——`K` 就在手上。
            resolve(trustValue<K>(message.value));
          } else {
            reject(new CommandFailedError(command, message.error.message, message.error.code));
          }
        },
      });
      this.transport.post({
        kind: MessageKind.Request,
        generation: this.generation,
        id,
        command,
        params,
      });
    });
  }

  /** 订阅「哪类数据过期了」。 */
  onDomainsChanged(listener: DomainsListener): void {
    this.listeners.add(listener);
  }

  /** 消息入口。喂进来的是未经检验的任意值——`window` 的 message 事件给什么就是什么。 */
  receive(raw: unknown): void {
    const message: Incoming | undefined = parseIncoming(raw);
    if (message === undefined) {
      this.logger.log(`丢弃：无法解析的消息`);
      return;
    }
    if (message.generation !== this.generation) {
      this.logger.log(`丢弃：代号不符（收到 ${message.generation}，本代 ${this.generation}）`);
      return;
    }

    if (message.kind === MessageKind.Event) {
      for (const listener of this.listeners) listener(message.repo, message.domains);
      return;
    }

    const waiting = this.pending.get(message.id);
    if (waiting === undefined) {
      // 同一个 id 回了两次，或回了一条没人等的 id。扩展侧保证「恰好回一次」，
      // 所以走到这里说明那个保证破了——记下来，别静默。
      this.logger.log(`丢弃：没有在等 id=${message.id} 的请求`);
      return;
    }
    this.pending.delete(message.id);
    waiting.settle(message);
  }
}
