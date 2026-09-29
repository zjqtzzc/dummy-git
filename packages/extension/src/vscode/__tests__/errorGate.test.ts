import { describe, expect, it } from "vitest";
import { GitFailureError } from "../../git/failure.js";
import { describeError, ErrorGate } from "../errorGate.js";

/** 一个可手动「关掉通知」的出口。 */
function fakeSink() {
  const logged: string[] = [];
  const shown: string[] = [];
  const closers: (() => void)[] = [];
  return {
    logged,
    shown,
    /** 关掉最早那条还开着的通知。 */
    closeOne: () => closers.shift()?.(),
    sink: {
      log: (text: string) => logged.push(text),
      show: (summary: string) =>
        new Promise<void>((resolve) => {
          shown.push(summary);
          closers.push(resolve);
        }),
    },
  };
}

describe("ErrorGate：未知错误的统一出口", () => {
  it("同一条通知还开着时不再弹，但日志每次都写", () => {
    const f = fakeSink();
    const gate = new ErrorGate(f.sink);
    gate.report(new Error("boom"));
    gate.report(new Error("boom"));
    expect(f.shown).toEqual(["boom"]);
    expect(f.logged).toHaveLength(2);
  });

  it("通知关掉之后，同一条错误再出现会再弹", async () => {
    const f = fakeSink();
    const gate = new ErrorGate(f.sink);
    gate.report(new Error("boom"));
    f.closeOne();
    await Promise.resolve(); // 让 finally 跑完
    await Promise.resolve();
    gate.report(new Error("boom"));
    expect(f.shown).toEqual(["boom", "boom"]);
  });

  it("不同的错误各弹各的", () => {
    const f = fakeSink();
    const gate = new ErrorGate(f.sink);
    gate.report(new Error("a"));
    gate.report(new Error("b"));
    expect(f.shown).toEqual(["a", "b"]);
  });
});

describe("describeError：通知一行、输出面板写全", () => {
  it("git 失败：摘要是命令 + 退出码 + stderr 第一行，--format 折叠；详情带完整 stderr", () => {
    const error = new GitFailureError(
      ["log", "--format=%H%x00", "-1"],
      128,
      "fatal: bad revision\nhint: line two",
    );
    const { summary, detail } = describeError(error);
    expect(summary).toBe("git log --format=... -1 failed (exit 128): fatal: bad revision");
    expect(detail).toContain("hint: line two");
  });

  it("普通 Error：摘要是 message，详情是堆栈", () => {
    const error = new Error("oops");
    expect(describeError(error)).toEqual({ summary: "oops", detail: error.stack });
  });

  it("抛出来的不是 Error 也能说清楚", () => {
    expect(describeError("plain")).toEqual({ summary: "plain", detail: "plain" });
  });
});
