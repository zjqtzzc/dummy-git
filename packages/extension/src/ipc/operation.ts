import { AsyncLocalStorage } from "node:async_hooks";
import { GitFailureError } from "../git/failure.js";
import { brief, briefResult, briefString, SLOW_MS } from "./brief.js";
import { isRecord } from "./protocol.guards.js";
import { UserFacingError } from "./userFacingError.js";

/** 带级别的日志出口。`vscode.LogOutputChannel` 直接满足它；本层因此不 import vscode。 */
export interface Log {
  readonly error: (line: string) => void;
  readonly warn: (line: string) => void;
  readonly info: (line: string) => void;
  readonly debug: (line: string) => void;
}

/**
 * 正在跑的操作：编号，以及到目前为止等用户回答花了多久。
 * 跨 `await` 自动带着走，入口设一次，里面谁要谁取。
 */
interface Current {
  readonly id: number;
  waitedMs: number;
}

const current = new AsyncLocalStorage<Current>();

/** 在操作里写的行带上它的编号；不在任何操作里（启动、文件监听）的原样。 */
export function tagged(line: string): string {
  const store = current.getStore();
  return store === undefined ? line : `#${store.id} ${line}`;
}

/**
 * 等用户回答（确认框、输入框、选择）：花的时间记到所在操作上。
 * 操作的用时扣掉它再判断慢不慢——人打字、犹豫的几秒不是我们慢。
 */
export async function waitingForUser<T>(ask: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    return await ask();
  } finally {
    const store = current.getStore();
    if (store !== undefined) store.waitedMs += Date.now() - started;
  }
}

/**
 * 操作：一件事从入口进来到结束。三个入口（webview 请求经 Router、右键菜单、自动 Fetch 这类后台任务）
 * 都经过这里，记开头与结尾两行；里面的 git 命令、问答由各自的出口经 `tagged()` 带上编号。
 *
 * 两行而不并成一行：挂住的操作只有开头那行，看得出卡在哪。
 * 编号整个扩展共用一个计数，几块页面、菜单与后台任务的操作不会重号。
 */
export class Operations {
  private next = 1;

  private readonly running = new Set<number>();
  private lastEnded: { readonly id: number; readonly at: number } | undefined;

  constructor(private readonly log: Log) {}

  /**
   * 此刻在跑哪些操作、上一个是哪个、多久前结束的。刷新那行用它：文件监听有防抖，
   * 分不清是哪个操作引起的，只写这些事实，不猜。都没有时是空串。
   */
  context(): string {
    const parts: string[] = [];
    if (this.running.size > 0) {
      parts.push(`进行中 ${[...this.running].map((id) => `#${id}`).join(" ")}`);
    }
    if (this.lastEnded !== undefined) {
      parts.push(`#${this.lastEnded.id} 在 ${Date.now() - this.lastEnded.at}ms 前结束`);
    }
    return parts.join("；");
  }

  async run<T>(
    source: string,
    command: string,
    params: unknown,
    task: () => Promise<T>,
  ): Promise<T> {
    const id = this.next++;
    const store: Current = { id, waitedMs: 0 };
    const started = Date.now();
    this.log.info(`#${id} ${source} → ${command} ${briefParams(params)}`);
    this.running.add(id);
    try {
      const value = await current.run(store, task);
      const took = timing(Date.now() - started, store.waitedMs);
      const result = briefResult(value);
      const line = `#${id} ✓ ${took.text}${result === "" ? "" : ` → ${result}`}`;
      if (took.slow) this.log.warn(line);
      else this.log.info(line);
      return value;
    } catch (error) {
      // 预料之中的失败（git 拒绝、已知情况）记 warn；其余是我们的 bug，记 error。
      // 详情由错误关口写，这里只记一行。
      const expected = error instanceof GitFailureError || error instanceof UserFacingError;
      const message = briefString(error instanceof Error ? error.message : String(error));
      const took = timing(Date.now() - started, store.waitedMs);
      const line = `#${id} ✗ ${took.text} ${message}`;
      if (expected) this.log.warn(line);
      else this.log.error(line);
      throw error;
    } finally {
      this.running.delete(id);
      this.lastEnded = { id, at: Date.now() };
    }
  }
}

/**
 * 参数的摘要。`repo` 不记：现阶段只有一个仓库，找到时记过一次（`logRepository`），
 * 每行都带一遍长路径只是噪音。
 */
function briefParams(params: unknown): string {
  if (!isRecord(params)) return brief(params);
  return brief(Object.fromEntries(Object.entries(params).filter(([key]) => key !== "repo")));
}

/** 用时写成 `2772ms（等用户 2740ms）`，没等过用户就只写总数；慢不慢按扣掉等用户之后的算。 */
function timing(ms: number, waitedMs: number): { readonly text: string; readonly slow: boolean } {
  const slow = ms - waitedMs > SLOW_MS;
  const waited = waitedMs > 0 ? `（等用户 ${waitedMs}ms）` : "";
  return { text: `${ms}ms${waited}${slow ? " (slow)" : ""}`, slow };
}
