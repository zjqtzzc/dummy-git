import {
  type CommandName,
  type CommandParams,
  type CommandResult,
  type Generation,
  type GitDomain,
  MessageKind,
  type OutboundMessage,
  type ProtocolError,
  ResponseKind,
} from "@dummy-git/shared";
import { GitFailureError } from "../git/failure.js";
import { InboundKind, parseInbound } from "./protocol.guards.js";

/**
 * 一条命令的处理函数。参数与返回值都由协议表推出来，写错编译不过。
 *
 * 它**不认识 `vscode`，也不认识信封**——只是「给我参数，还你结果」。
 * 收消息、校验、配 id、发响应是 `Router`（M7-3）的事。
 */
export type Handler<K extends CommandName> = (
  params: CommandParams<K>,
) => Promise<CommandResult<K>>;

/** 协议表里每一条命令都必须有一个处理函数。 */
export type HandlerMap = { [K in CommandName]: Handler<K> };

/**
 * 注册全部 handler 的唯一入口。
 *
 * ## 为什么是「一次性给全」，而不是逐条 `handle("名字", fn)`
 *
 * 旧仓库正是逐条注册的，结果实测：协议声明 76 条、实际注册 89 条、**游离 13 条**。
 * 散落在 1720 行 `extension.ts` 里的 89 次 `.handle()` 调用，没有任何一处能看出
 * 「表里的每条都注册了吗」。**一次性给全，这个问题在结构上不存在**——
 * 而且整个对外表面积可以从上到下读一遍。
 *
 * ## 它拦住什么（全部实测，见 `__tests__/protocolCompileChecks.ts`）
 *
 * | 写错的方式 | 编译错误 |
 * |---|---|
 * | 漏一条 | `TS2345`（缺少属性） |
 * | 多一条（表外的命令） | `TS2345`（多余键被收窄成 `never`） |
 * | 返回类型不对 | `TS2322` |
 * | 参数用错字段 | `TS2339` |
 *
 * ## 为什么不是直接写 `const handlers: HandlerMap = { … }`
 *
 * 那样也能拦住这四种，**但只在写成字面量时**。TypeScript 的多余属性检查只对
 * 字面量生效；一旦有人改成 `const built = {…}; const handlers: HandlerMap = built;`
 * （变量），多注册就**静默通过**，而代码看起来毫无变化。实测确认。
 *
 * `Record<Exclude<keyof T, CommandName>, never>` 把「表外的键」收窄成 `never`，
 * 于是变量形态下同样拦得住——**保护不依赖调用方的书写习惯**。
 *
 * 守卫真实存在，但它守的东西可能与你以为的不是一个：完备性断言只拦漏、不拦多。
 */
export function defineHandlers<T extends HandlerMap>(
  handlers: T & Record<Exclude<keyof T, CommandName>, never>,
): HandlerMap {
  return handlers;
}

/**
 * 消息怎么发出去。**注入式，`Router` 因此不 import `vscode`。**
 *
 * 与 M2 的 `GitLogger` 同一手法：这一层只描述形状，
 * 由 `vscode/panel.ts` 接到真正的 `Webview.postMessage` 上。
 * 好处是 `Router` 能在纯 node 下测——不必为了验「请求走通了没有」去起一个 VSCode 宿主。
 */
export interface Transport {
  readonly post: (message: OutboundMessage) => void;
}

/** Router 往外说话的出口。同样注入，默认什么都不做。 */
export interface RouterHooks {
  /** 记一行流水（用时、丢弃原因）。 */
  readonly log: (line: string) => void;
  /**
   * 请求失败时交给错误关口（`vscode/errorGate.ts`）：输出面板写全、弹通知。
   * Router 是三个关口之一（`ARCHITECTURE.md` 第 15 题），handler 不自己 `catch`。
   */
  readonly report: (error: unknown) => void;
}

const NOOP_HOOKS: RouterHooks = { log: () => {}, report: () => {} };

/**
 * 把 `GitFailureError` 转成协议里的错误。
 *
 * `code` 可能缺席——M4 的 `classifyError` 对认不出的 stderr 返回 `undefined`，
 * 因为 git 的错误文案本来就是开放集。**决策看 `code`，排查看 `message`。**
 *
 * 非 `GitFailureError`（我们自己的 bug、解析失败）没有 `code`，
 * 但必须照样回一条响应——见 `respondOnce` 的理由。
 */
function toProtocolError(error: unknown): ProtocolError {
  if (error instanceof GitFailureError) {
    // `exactOptionalPropertyTypes` 下不能写 `{ code: undefined }`——
    // 「字段不存在」与「字段是 undefined」是两回事，分开写。
    return error.code === undefined
      ? { message: error.stderr }
      : { code: error.code, message: error.stderr };
  }
  return { message: error instanceof Error ? error.message : String(error) };
}

/**
 * 收消息、校验、分发、回响应。
 *
 * ## 「每条请求恰好回一次」是不设超时的前提
 *
 * 协议层**没有统一超时**：写命令会排队，
 * 排在慢命令后面的那条可能等很久，一旦超时，UI 说「失败了」而 git **还在跑**——
 * 那不是失败，是撒谎，用户会重试一个正在成功的提交。
 *
 * 不设超时的代价是「响应丢了就永远等下去」。**所以响应不能丢**：
 * 成功回成功、抛异常回错误、`finally` 兜底，三条路合起来覆盖全部出口。
 * 这不是防御性检查——这是让「等不到回复」这件事不可能发生。
 */
export class Router {
  /** 当前这一代 webview。ready 握手时确定（M7-5），此前不接受任何请求。 */
  private generation: Generation | undefined;

  constructor(
    private readonly transport: Transport,
    private readonly handlers: HandlerMap,
    private readonly hooks: RouterHooks = NOOP_HOOKS,
  ) {}

  /**
   * 消息入口。喂进来的是**未经检验的任意值**——`postMessage` 给什么就是什么。
   *
   * 三种丢弃，都记日志（静默丢弃是最难查的那类问题）：
   * - 信封不可理解：连 id 都没有，**回不了**，只能丢
   *   （读得出 id、只是命令名或参数不对的，回一个错误，见 `reject`）
   * - 代号对不上：上一代 webview 的残留请求，回了也没人要
   * - 还没握手：`generation` 未定，此时不该有任何请求
   */
  receive(raw: unknown): void {
    const inbound = parseInbound(raw);
    if (inbound === undefined) {
      this.hooks.log(`丢弃：无法解析的消息 ${JSON.stringify(raw)?.slice(0, 200)}`);
      return;
    }
    if (inbound.kind === InboundKind.Rejected) {
      this.reject(inbound.generation, inbound.id, inbound.reason);
      return;
    }
    const { message } = inbound;

    if (message.kind === MessageKind.Ready) {
      const previous = this.generation;
      this.generation = message.generation;
      this.hooks.log(
        previous === undefined
          ? `ready：代号 ${message.generation}`
          : `ready：换代 ${previous} → ${message.generation}，上一代的在途响应将被丢弃`,
      );
      return;
    }

    if (this.generation === undefined) {
      this.hooks.log(`丢弃：握手前收到请求 ${message.command}`);
      return;
    }
    if (message.generation !== this.generation) {
      this.hooks.log(
        `丢弃：代号不符（收到 ${message.generation}，当前 ${this.generation}）${message.command}`,
      );
      return;
    }

    void this.dispatch(message.generation, message.id, message.command, message.params);
  }

  /**
   * 读得出 id、但命令名或参数不对的请求：回一个错误，并交给错误关口。
   * 不回的话前端会一直等下去（按钮停在「进行中」）。常见成因是 webview 与扩展宿主版本不一致。
   * 代号对不上的照样丢：那是上一代的请求，回了也没人要。
   */
  private reject(generation: Generation, id: number, reason: string): void {
    if (generation !== this.generation) {
      this.hooks.log(`丢弃：代号不符的不合法请求（${reason}）`);
      return;
    }
    this.transport.post({
      kind: MessageKind.Response,
      generation,
      id,
      result: ResponseKind.Error,
      error: { message: reason },
    });
    this.hooks.log(`拒绝：${reason}`);
    this.hooks.report(new Error(`Rejected request: ${reason}`));
  }

  /**
   * 跑一条命令，**恰好回一次**。
   *
   * `respondOnce` 的守卫不是多余的：`post` 本身可能抛（面板已销毁），
   * 那时 `catch` 会再回一次。有了它，「回两次」和「一次不回」都不可能。
   */
  private async dispatch<K extends CommandName>(
    generation: Generation,
    id: number,
    command: K,
    params: CommandParams<K>,
  ): Promise<void> {
    let answered = false;
    const respondOnce = (message: OutboundMessage): void => {
      if (answered) return;
      answered = true;
      // 命令跑着的时候面板可能已经换了一代（隐藏再显示、VSCode 重载）。
      // 那条回复对新一代毫无意义：它等的是**自己**那条 id，编号还是从 1 开始的。
      // 发过去就是串台，而且内容看起来完全合法——webview 侧也拦，这里是同一道判断的另一半。
      if (generation !== this.generation) {
        this.hooks.log(`不发：${command} 的回复属于上一代 ${generation}`);
        return;
      }
      this.transport.post(message);
    };

    const started = Date.now();
    try {
      const value: CommandResult<K> = await this.handlers[command](params);
      respondOnce({ kind: MessageKind.Response, generation, id, result: ResponseKind.Ok, value });
      this.hooks.log(`${command} 用时 ${Date.now() - started}ms`);
    } catch (error) {
      const protocolError = toProtocolError(error);
      respondOnce({
        kind: MessageKind.Response,
        generation,
        id,
        result: ResponseKind.Error,
        error: protocolError,
      });
      // 错误内容由关口写（report），这里只记用时，与成功时那行对称。
      this.hooks.log(`${command} 失败（${Date.now() - started}ms）`);
      this.hooks.report(error);
    }
  }

  /**
   * 广播「哪类数据过期了」。**只说过期，不带数据。**
   *
   * 这是扩展侧唯一主动发出的东西，而它也只是个通知。
   * 总原则是**前端初始化时主动向后端要数据**（`DECISIONS.md`），
   * 扩展侧永远不推数据——算新值要 1.9 秒 / 360 MB（`NFR.md` §5.3），
   * 而此刻可能根本没人在看那个面板，**只有前端知道自己要不要**。
   *
   * **握手之前一个字节都不发。** 这正是握手要解决的问题：webview 是一张网页，
   * 它的脚本挂上监听之前，`postMessage` 发过去的东西会**静静地丢掉，不报任何错**。
   *
   * 旧仓库在这里用的是 `setTimeout(…, 200)` 配一句注释「稍微延迟一下，确保面板都准备好了」
   * （`views/commitViewProvider.ts:51`）。那不是机制，是赌博：慢机器 200ms 不够，
   * 快机器纯属浪费，而失败的表现是「偶尔面板是空的、刷新一下又好了」——最难查的那类。
   *
   * 握手是**因果**（等到了才发），延时是**猜测**（估计好了吧）。
   */
  broadcast(repo: string, domains: readonly GitDomain[]): void {
    if (this.generation === undefined) {
      this.hooks.log("不发：握手之前不广播");
      return;
    }
    this.transport.post({
      kind: MessageKind.Event,
      generation: this.generation,
      event: "domainsChanged",
      payload: { repo, domains },
    });
  }
}
