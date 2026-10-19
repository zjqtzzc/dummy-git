import { describe, expect, it } from "vitest";
import { LockPolicy } from "../../git/commands/index.js";
import { CommandQueue } from "../operation.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 记录一个动作的开始/结束相对时刻，供断言时序用。 */
function timed(label: string, timeline: string[], ms: number, fail = false) {
  return async () => {
    timeline.push(`${label}:start`);
    await sleep(ms);
    timeline.push(`${label}:end`);
    if (fail) throw new Error(`${label} 故意失败`);
    return label;
  };
}

describe("CommandQueue：写命令排队", () => {
  it("三条写命令串行——不会有两条同时在跑", async () => {
    const queue = new CommandQueue();
    const timeline: string[] = [];
    await Promise.all([
      queue.run(LockPolicy.Exclusive, timed("A", timeline, 30)),
      queue.run(LockPolicy.Exclusive, timed("B", timeline, 30)),
      queue.run(LockPolicy.Exclusive, timed("C", timeline, 30)),
    ]);
    // 串行的充分必要条件：每个 start 之前，上一个已经 end 了。
    expect(timeline).toEqual(["A:start", "A:end", "B:start", "B:end", "C:start", "C:end"]);
  });
});

describe("CommandQueue：读命令不排队", () => {
  it("三条读命令几乎同时开始", async () => {
    const queue = new CommandQueue();
    const timeline: string[] = [];
    await Promise.all([
      queue.run(LockPolicy.None, timed("A", timeline, 10)),
      queue.run(LockPolicy.None, timed("B", timeline, 10)),
      queue.run(LockPolicy.None, timed("C", timeline, 10)),
    ]);
    // 全部立刻开始：三个 start 排在最前面，不会有 start 夹在别人的 start/end 之间。
    const starts = timeline.filter((e) => e.endsWith(":start"));
    expect(timeline.slice(0, 3).sort()).toEqual(starts.sort());
  });
});

describe("CommandQueue：两条道", () => {
  it("远程道串行——两条网络命令不同时跑（否则会撞引用锁）", async () => {
    const queue = new CommandQueue();
    const timeline: string[] = [];
    await Promise.all([
      queue.run(LockPolicy.Remote, timed("fetch", timeline, 30)),
      queue.run(LockPolicy.Remote, timed("push", timeline, 30)),
    ]);
    expect(timeline).toEqual(["fetch:start", "fetch:end", "push:start", "push:end"]);
  });

  it("两条道互不等待——慢推送期间本地写命令照样跑", async () => {
    const queue = new CommandQueue();
    const timeline: string[] = [];
    await Promise.all([
      queue.run(LockPolicy.Remote, timed("push", timeline, 60)),
      queue.run(LockPolicy.Exclusive, timed("commit", timeline, 10)),
    ]);
    expect(timeline).toEqual(["push:start", "commit:start", "commit:end", "push:end"]);
  });
});

describe("CommandQueue：失败不断链", () => {
  it("中间一条写命令失败，后面的仍然要跑", async () => {
    const queue = new CommandQueue();
    const timeline: string[] = [];
    const results = await Promise.allSettled([
      queue.run(LockPolicy.Exclusive, timed("A", timeline, 10)),
      queue.run(LockPolicy.Exclusive, timed("B", timeline, 10, true)),
      queue.run(LockPolicy.Exclusive, timed("C", timeline, 10)),
    ]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
    // C 确实跑了，且排在 B 之后（不是被跳过或并发跑掉的）
    expect(timeline).toContain("C:start");
    expect(timeline.indexOf("C:start")).toBeGreaterThan(timeline.indexOf("B:end"));
  });

  it("失败不会产生未处理的 rejection（队尾必须剥掉失败）", async () => {
    // 队列内部把失败的结果从 tail 链上剥掉，只用来排队、不传递结果——
    // 不剥的话一次失败会连锁掐死后面所有写命令，还会在 Node 里报未处理 rejection。
    const queue = new CommandQueue();
    await expect(
      queue.run(LockPolicy.Exclusive, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    // 队列还能正常接受下一条命令，证明它没被打断
    const result = await queue.run(LockPolicy.Exclusive, async () => "ok");
    expect(result).toBe("ok");
  });
});
