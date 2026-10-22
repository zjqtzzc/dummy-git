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

/** 正在跑的操作的编号。跨 `await` 自动带着走，入口设一次，里面谁要谁取。 */
const current = new AsyncLocalStorage<number>();

/** 在操作里写的行带上它的编号；不在任何操作里（启动、文件监听）的原样。 */
export function tagged(line: string): string {
  const id = current.getStore();
  return id === undefined ? line : `#${id} ${line}`;
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
    const started = Date.now();
    this.log.info(`#${id} ${source} → ${command} ${briefParams(params)}`);
    this.running.add(id);
    try {
      const value = await current.run(id, task);
      const ms = Date.now() - started;
      const result = briefResult(value);
      const line = `#${id} ✓ ${ms}ms${slowMark(ms)}${result === "" ? "" : ` → ${result}`}`;
      if (ms > SLOW_MS) this.log.warn(line);
      else this.log.info(line);
      return value;
    } catch (error) {
      // 预料之中的失败（git 拒绝、已知情况）记 warn；其余是我们的 bug，记 error。
      // 详情由错误关口写，这里只记一行。
      const expected = error instanceof GitFailureError || error instanceof UserFacingError;
      const message = briefString(error instanceof Error ? error.message : String(error));
      const ms = Date.now() - started;
      const line = `#${id} ✗ ${ms}ms${slowMark(ms)} ${message}`;
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

function slowMark(ms: number): string {
  return ms > SLOW_MS ? " (slow)" : "";
}
