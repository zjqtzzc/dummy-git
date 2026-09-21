/**
 * webview 这一侧的边界校验：**验它收到的东西**。
 *
 * ## 「你验你收到的」
 *
 * | 谁 | 验什么 | 在哪 |
 * |---|---|---|
 * | extension | webview 发来的 `Ready` / `Request` | `extension/src/ipc/protocol.guards.ts` |
 * | webview | extension 发来的 `Response` / `Event` | 本文件 |
 *
 * 各自守自己的入口，谁也不替对方验——否则「到底验没验过」会变成没人说得清的问题。
 *
 * ## 验到什么程度：**验我们据以分支的，不验原样转交的**
 *
 * | 字段 | 验不验 | 为什么 |
 * |---|---|---|
 * | `id` / `generation` / `kind` / `result` | ✅ | **路由信息**。错了会把响应派给别的请求——静默的数据错乱，比崩溃难查得多 |
 * | `error.code` | ✅ | 界面要按它分支（不同错误给不同提示），闭集必须真的在集里 |
 * | `event.payload.domains` | ✅ | 界面要按它决定重拉什么，同样是分支依据 |
 * | `response.value` | ❌ | **原样交给发起那次请求的调用方**，这一层不看它一眼 |
 *
 * `value` 不验，是因为验它等于把每条命令的返回类型再用运行时代码写一遍
 * （三条命令 → 三个深校验器，而且每加一条命令就要记得加一个）。
 * 而它的来源是**扩展宿主**——我们自己的 node 代码，形状由本仓库决定。
 * 真出现形状不对，那是我们的 bug，应该在用到的地方炸出来，
 * 而不是被一层 validator 悄悄吃掉，变成「界面空白但没有任何报错」。
 *
 * 对面验得深，是因为那些参数会变成 git 子进程的命令行，
 * 验浅了就是 `undefined` 流进 `spawn`，报一句 `spawn EINVAL`，与真正的原因隔着十万八千里。
 */

import type { CommandName, CommandResult } from "@dummy-git/shared";
import {
  type EventName,
  type Generation,
  GitDomain,
  GitErrorCode,
  MessageKind,
  type ProtocolError,
  ResponseKind,
} from "@dummy-git/shared";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isGitDomain(value: unknown): value is GitDomain {
  return typeof value === "string" && Object.values<string>(GitDomain).includes(value);
}

function isGitErrorCode(value: unknown): value is GitErrorCode {
  return typeof value === "string" && Object.values<string>(GitErrorCode).includes(value);
}

/**
 * 收到的东西，信封已验、载荷未验。
 *
 * **不是 `OutboundMessage`**，是刻意的：那个类型里的 `value` 是
 * 「某条命令的返回值」，而这一层根本不知道是哪条命令——那个知识在发起请求的地方。
 * 硬要拼成 `OutboundMessage` 就得给 `value` 编一个值或者写类型断言，
 * 两条都是在类型上撒谎。这里老老实实把它留成 `unknown`。
 */
export type Incoming =
  | {
      readonly kind: MessageKind.Response;
      readonly generation: Generation;
      readonly id: number;
      readonly ok: true;
      readonly value: unknown;
    }
  | {
      readonly kind: MessageKind.Response;
      readonly generation: Generation;
      readonly id: number;
      readonly ok: false;
      readonly error: ProtocolError;
    }
  | {
      readonly kind: MessageKind.Event;
      readonly generation: Generation;
      readonly event: EventName;
      readonly repo: string;
      readonly domains: readonly GitDomain[];
    };

function parseError(raw: unknown): ProtocolError | undefined {
  if (!isRecord(raw)) return undefined;
  const message = raw["message"];
  if (typeof message !== "string") return undefined;
  const code = raw["code"];
  // `exactOptionalPropertyTypes`：「字段不存在」与「字段是 undefined」是两回事。
  if (code === undefined) return { message };
  return isGitErrorCode(code) ? { code, message } : undefined;
}

/** 校验信封。返回 `undefined` = 这条消息没法路由，只能丢并记日志。 */
export function parseIncoming(raw: unknown): Incoming | undefined {
  if (!isRecord(raw)) return undefined;

  const generation = raw["generation"];
  if (typeof generation !== "string" || generation.length === 0) return undefined;

  if (raw["kind"] === MessageKind.Response) {
    const id = raw["id"];
    if (typeof id !== "number" || !Number.isInteger(id)) return undefined;

    if (raw["result"] === ResponseKind.Ok) {
      return { kind: MessageKind.Response, generation, id, ok: true, value: raw["value"] };
    }
    if (raw["result"] === ResponseKind.Error) {
      const error = parseError(raw["error"]);
      return error === undefined
        ? undefined
        : { kind: MessageKind.Response, generation, id, ok: false, error };
    }
    return undefined;
  }

  if (raw["kind"] === MessageKind.Event) {
    // 目前只有一个事件。加第二个时这里要按 `event` 分支——
    // 那时把它做成与 `PARAM_GUARDS` 同样的「每个事件一个校验器」的完整表。
    if (raw["event"] !== "domainsChanged") return undefined;
    const payload = raw["payload"];
    if (!isRecord(payload)) return undefined;

    const repo = payload["repo"];
    const domains = payload["domains"];
    if (typeof repo !== "string") return undefined;
    if (!Array.isArray(domains) || !domains.every(isGitDomain)) return undefined;

    return { kind: MessageKind.Event, generation, event: "domainsChanged", repo, domains };
  }

  return undefined;
}

/**
 * 把未经校验的 `value` 按「发起请求时声明的返回类型」交回去。
 *
 * **这是全项目 webview 侧唯一的类型断言**，集中在这里而不是散在 `client.ts`，
 * 正是 `CLAUDE.md` B.8 那条豁免的用意：把 `unknown` 变成类型是守卫的活。
 *
 * 它是一次**明示的信任**，不是检查——理由见文件头「验我们据以分支的，
 * 不验原样转交的」。取个名字、写清楚，比在业务代码里写一个裸 `as` 强：
 * 以后想给某条命令加深校验，改这里一处就够。
 */
export function trustValue<K extends CommandName>(value: unknown): CommandResult<K> {
  return value as CommandResult<K>;
}
