import type { CommitFileChange } from "./change.js";
import type { Commit, CommitSkeleton } from "./commit.js";
import type { DiffOpenMode, DiffSide } from "./diff.js";
import type { GitDomain } from "./domain.js";
import type { GitErrorCode } from "./error.js";
import type { Ref } from "./ref.js";

/**
 * extension ↔ webview 的全部对话内容。**这张表是唯一来源。**
 *
 * ## 它要解决的具体问题
 *
 * 旧仓库的 `shared/protocol.ts` 也自称唯一来源，实测（本人复核）：
 *
 * ```
 * 声明 76 条命令 / 实际注册 89 条 / 游离在协议之外 13 条
 * ```
 *
 * 那 13 条能存在，是因为注册函数接受**任意字符串**。后果不是崩溃，
 * 是没人知道协议到底有哪些命令——改一条消息时无从判断谁会受影响。
 *
 * 本文件的目标：**协议表与实现之间的任何不一致，都在 `pnpm check` 时报错。**
 * 两个方向由**两个不同的机制**保证，见 `ipc/router.ts`：
 *
 * | 方向 | 谁拦的 |
 * |---|---|
 * | 漏注册（表里有、没注册） | `router.ts` 的完备性断言 |
 * | 多注册（注册了表外的） | `handle<K extends keyof Commands>` 的泛型签名 |
 *
 * **不要把两者混为一谈**（`LESSONS.md` 2026-09-21）：完备性断言拦不住多注册——
 * TypeScript 的多余属性检查只对**字面量**生效，而真实的注册表是由 `handle()`
 * 逐条累积出来的变量。实测多注册时断言零报错。
 *
 * ## 为什么在 `shared/`
 *
 * 两侧都要认识它。与 `Commit` / `Ref` / `FileChange` 放这里是同一个判断。
 * 但 router 的**实现**必须留在 `extension/`——它要 import `vscode`，
 * 而 `shared/` 被 lint 禁止（`CLAUDE.md` §A）。
 */

// ─────────────────────────────────────────────────────────────────────────────
// 命令表：webview 问，extension 答
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 每条命令声明「要什么参数」「返回什么」。
 *
 * **除 `getRepositories` 外每条都带 `repo`**（它就是用来问「有哪些 repo」的，
 * 带一个自己要去查的东西没有意义）。MVP 只支持一个仓库，这个值永远相同——
 * 但**现在加是一个字段，将来加是重写契约**：协议的封闭性意味着改它会让编译全线报错
 * （`PLAN.md`「M7 追加两条」）。
 *
 * 取数分两步（`DECISIONS.md`「M3 log 取数模型」）：`getSkeleton` 跑遍全历史但每条
 * 只有三个字段，`getCommitDetails` 只取当前要显示的那几十条。实测在 vscode 仓库
 * （188,163 条）上是 1,937 ms vs 11 ms（`NFR.md` §5.3）。
 */
export interface Commands {
  /**
   * 有哪些仓库。**唯一不带 `repo` 的命令**，因为它就是用来回答「有哪些 repo」的。
   *
   * webview 启动时先问这一句，再拿着答案去请求别的。
   *
   * 否决过「把仓库路径写进 HTML 的 `data-repo`」：那样等于把「有哪些仓库」这个答案
   * **烤进页面**，而且是由扩展替用户选好的那一个。多仓库时面板不该由扩展替用户挑，
   * 该是 webview 列出来让人选——那时改的只有这里的返回值从一条变多条，
   * 面板与协议都不用动。
   *
   * 第一版永远只返回一条。
   */
  getRepositories: {
    params: Record<string, never>;
    result: readonly string[];
  };
  /** 全量骨架：每条只有 hash / parents / at，用来排图和定位。 */
  getSkeleton: {
    params: { repo: string };
    result: CommitSkeleton[];
  };
  /** 按 hash 取详情：作者、时间、完整消息。只取要显示的那几十条。 */
  getCommitDetails: {
    params: { repo: string; hashes: readonly string[] };
    result: Commit[];
  };
  /**
   * 分支、tag，外加一条 HEAD（`RefKind.Head`，detached 时没有 `branch`）。
   * 左栏分支树用。HEAD 不在 `refs/` 下，扩展侧额外问一次合进来，webview 一次拿全。
   */
  getRefs: {
    params: { repo: string };
    result: Ref[];
  };
  /**
   * 用 VS Code 的 diff 编辑器打开左右两边。左右可以是任意一种 `DiffSide`，自由组合。
   * 插件的 diff 始终只占一个标签；`mode` 决定是打开还是跟随选中。标题由扩展统一拼。
   */
  openDiff: {
    params: { repo: string; left: DiffSide; right: DiffSide; mode: DiffOpenMode };
    result: null;
  };
  /** 一条提交改了哪些文件。端到端验收里「点一条」那一下。 */
  getCommitFiles: {
    params: { repo: string; hash: string };
    result: CommitFileChange[];
  };
}

export type CommandName = keyof Commands;
export type CommandParams<K extends CommandName> = Commands[K]["params"];
export type CommandResult<K extends CommandName> = Commands[K]["result"];

// ─────────────────────────────────────────────────────────────────────────────
// 事件表：extension 单向广播，没有返回值
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **事件只说「哪类数据过期了」，不带新数据。**
 *
 * 算出新值要跑 `git log` + `for-each-ref`，在 vscode 仓库上是 1.9 秒 / 360 MB
 * （`NFR.md` §5.3），而此刻可能根本没人在看那个面板。
 * 让消费者自己决定要不要拉，是唯一不浪费的做法（M6 定）。
 *
 * `domains` 不是摆设：webview 应当**只在自己关心的域出现时**才重拉。
 * 保存一次工作区文件只会得到 `worktree`，不该触发提交图重算——
 * 那是 M6 分域最主要的收益，在这里兑现。
 */
export interface Events {
  domainsChanged: { repo: string; domains: readonly GitDomain[] };
}

export type EventName = keyof Events;
export type EventPayload<E extends EventName> = Events[E];

// ─────────────────────────────────────────────────────────────────────────────
// 信封：postMessage 上实际跑的东西
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 一代 webview 的代号，在 ready 握手时确定。
 *
 * webview 会被销毁重建（面板隐藏再显示、VSCode 重载），新一代的请求 id 从头开始。
 * 若扩展侧还有上一代的请求在跑，它完成时发出的 `{ id: 1, … }` 会被新一代
 * **当成自己那条 id=1 的回复**——串台，且内容看起来完全合法。
 *
 * 代号对不上的一律丢弃。它同时也是清理时机：
 * 收到新 ready 就丢弃上一代的一切（`design/M7-protocol.md` §5.4、§5.6）。
 */
export type Generation = string;

export enum MessageKind {
  /** webview → extension：我准备好了，这是我的代号。 */
  Ready = "ready",
  /** webview → extension：问一句。 */
  Request = "request",
  /** extension → webview：答一句。 */
  Response = "response",
  /** extension → webview：广播，无需回复。 */
  Event = "event",
}

export interface ReadyMessage {
  readonly kind: MessageKind.Ready;
  readonly generation: Generation;
}

/**
 * `id` 在一代之内递增，用来把「问」和「答」配对——`postMessage` 本身
 * 没有「回复」这个概念，它只是往对面扔一段数据。
 *
 * **不做溢出处理**：`Number.MAX_SAFE_INTEGER` 是 9,007,199,254,740,991，
 * 即使每秒 1000 个请求不间断也要 28.6 万年（实测计算），
 * 且每代归零。为它加环绕逻辑 = 给不存在的问题造答案。
 */
export interface RequestMessage<K extends CommandName = CommandName> {
  readonly kind: MessageKind.Request;
  readonly generation: Generation;
  readonly id: number;
  readonly command: K;
  readonly params: CommandParams<K>;
}

export enum ResponseKind {
  Ok = "ok",
  Error = "error",
}

/**
 * 失败时 `code` 可能缺席——M4 的 `classifyError` 对认不出的 stderr 返回
 * `undefined`，因为 **git 的错误文案本来就是开放集，认不出是常态不是故障**。
 * 不设 `Unknown` 成员：那等于让「我不知道」伪装成一个结论。
 *
 * **决策看 `code`，排查看 `message`。** `message` 是 stderr 原文，不用于决策。
 */
export interface ProtocolError {
  readonly code?: GitErrorCode;
  readonly message: string;
}

export type ResponseMessage<K extends CommandName = CommandName> =
  | {
      readonly kind: MessageKind.Response;
      readonly generation: Generation;
      readonly id: number;
      readonly result: ResponseKind.Ok;
      readonly value: CommandResult<K>;
    }
  | {
      readonly kind: MessageKind.Response;
      readonly generation: Generation;
      readonly id: number;
      readonly result: ResponseKind.Error;
      readonly error: ProtocolError;
    };

export interface EventMessage<E extends EventName = EventName> {
  readonly kind: MessageKind.Event;
  readonly generation: Generation;
  readonly event: E;
  readonly payload: EventPayload<E>;
}

/** webview → extension 方向可能出现的一切。 */
export type InboundMessage = ReadyMessage | RequestMessage;
/** extension → webview 方向可能出现的一切。 */
export type OutboundMessage = ResponseMessage | EventMessage;

/**
 * ⚠️ 这两个联合类型在**运行时是谎言**——类型编译后就没了。
 * 从 `postMessage` 收到的东西必须先过 validator 才能当它们用
 * （`CLAUDE.md` C.1：这是全项目第二个也是最后一个校验点）。
 * 过关之后一律信任类型，不写防御性检查（C.2）。
 */
