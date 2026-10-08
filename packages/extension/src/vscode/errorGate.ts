import { GitFailureError } from "../git/failure.js";
import { UserFacingError } from "../ipc/userFacingError.js";

/**
 * 关口往外说话的两个出口，由 `extension.ts` 用 VSCode API 实现后注入。
 * 本文件不 import vscode，为的是能在纯 node 下测去重与文案。
 */
export interface ErrorSink {
  /** 写进输出面板。 */
  readonly log: (text: string) => void;
  /** 弹错误通知。**通知关闭时才 resolve**——去重靠这一点知道它还开着没有。 */
  readonly show: (summary: string) => Promise<void>;
}

/**
 * 未知错误的统一出口（`ARCHITECTURE.md` 第 15 题）。
 *
 * 已知错误写进命令的返回类型，由功能代码按 `kind` 换成一句话（`UserFacingError`）交过来，
 * 这里只照着显示；其余抛出来的都算未知：输出面板写全，弹一条通知让用户知道操作不是没有反馈。
 * 功能代码不自己 `catch`，只在关口（Router、命令注册、后台任务）交给它。
 */
export class ErrorGate {
  /** 正开着的通知的摘要。同一句还开着就不再弹，免得刷新反复失败时刷屏。 */
  private readonly open = new Set<string>();

  constructor(private readonly sink: ErrorSink) {}

  report(error: unknown): void {
    const { summary, detail } = describeError(error);
    // 日志每次都写：事后排查要看到每一次，去重只针对打扰人的通知。
    this.sink.log(detail);
    if (this.open.has(summary)) return;
    this.open.add(summary);
    void this.sink.show(summary).finally(() => this.open.delete(summary));
  }
}

/** 通知用一行摘要，输出面板用完整内容。界面文字用英文（需求第 1 阶段）。 */
export function describeError(error: unknown): { summary: string; detail: string } {
  if (error instanceof UserFacingError) {
    return {
      summary: error.message,
      detail: error.detail === undefined ? error.message : `${error.message}\n${error.detail}`,
    };
  }
  if (error instanceof GitFailureError) {
    const command = error.args
      .map((arg) => (arg.startsWith("--format=") ? "--format=..." : arg))
      .join(" ");
    const failed = `git ${command} failed (exit ${error.exitCode}):`;
    const firstLine = error.stderr.split("\n")[0] ?? "";
    // 输出面板写 stderr 全文，开头那句不再带第一行，免得它出现两次。
    return { summary: `${failed} ${firstLine}`, detail: `${failed}\n${error.stderr}` };
  }
  if (error instanceof Error) {
    return { summary: error.message, detail: error.stack ?? error.message };
  }
  const text = String(error);
  return { summary: text, detail: text };
}
