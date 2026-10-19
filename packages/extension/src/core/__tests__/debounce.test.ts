import { describe, expect, it, vi } from "vitest";
import { DebouncedSet } from "../debounce.js";

/** 用假时钟：真等 150ms/1000ms 会让这组测试变成全套里最慢的部分。 */
function withFakeTimers<T>(fn: () => T): T {
  vi.useFakeTimers();
  try {
    return fn();
  } finally {
    vi.useRealTimers();
  }
}

describe("DebouncedSet：聚合语义是并集", () => {
  it("一个窗口里的多个域合并成一次回调", () => {
    withFakeTimers(() => {
      const flushes: string[][] = [];
      const d = new DebouncedSet<string>((s) => flushes.push([...s]), 150, 1000);

      // 一次 commit 同时命中 refs 与 worktree，分两批到达
      d.add(["refs"]);
      d.add(["worktree", "refs"]);

      vi.advanceTimersByTime(149);
      expect(flushes).toEqual([]); // 还没到点

      vi.advanceTimersByTime(1);
      expect(flushes).toEqual([["refs", "worktree"]]); // 一次，并集
    });
  });

  it("空集合不启动计时——不会凭空触发一次空回调", () => {
    withFakeTimers(() => {
      const flushes: string[][] = [];
      const d = new DebouncedSet<string>((s) => flushes.push([...s]), 150, 1000);
      d.add([]);
      vi.advanceTimersByTime(5000);
      expect(flushes).toEqual([]);
    });
  });
});

describe("DebouncedSet：trailing debounce", () => {
  it("事件持续涌入时计时器不断推迟", () => {
    withFakeTimers(() => {
      const flushes: string[][] = [];
      const d = new DebouncedSet<string>((s) => flushes.push([...s]), 150, 1000);

      // 每 100ms 来一个，窗口一直被推迟
      for (let i = 0; i < 5; i++) {
        d.add([`e${i}`]);
        vi.advanceTimersByTime(100);
      }
      expect(flushes).toEqual([]); // 500ms 过去了，一次都没触发

      vi.advanceTimersByTime(150); // 流停下来
      expect(flushes).toHaveLength(1);
      expect(flushes[0]).toHaveLength(5);
    });
  });
});

describe("DebouncedSet：maxWait 防饿死", () => {
  it("持续不断的事件流最多憋 maxWaitMs 就必须触发", () => {
    withFakeTimers(() => {
      const flushes: string[][] = [];
      const d = new DebouncedSet<string>((s) => flushes.push([...s]), 150, 1000);

      // 每 100ms 来一个，永不停止——只靠 trailing 的话永远不会触发
      for (let i = 0; i < 20; i++) {
        d.add([`e${i}`]);
        vi.advanceTimersByTime(100);
      }

      // 2000ms 里至少触发了两次（每轮上限 1000ms）
      expect(flushes.length).toBeGreaterThanOrEqual(2);
    });
  });
});

describe("DebouncedSet：flushNow / cancel", () => {
  it("flushNow 立刻触发并清空", () => {
    withFakeTimers(() => {
      const flushes: string[][] = [];
      const d = new DebouncedSet<string>((s) => flushes.push([...s]), 150, 1000);
      d.add(["a"]);
      d.flushNow();
      expect(flushes).toEqual([["a"]]);

      // 已经清空了，计时器到点不该再触发一次空回调
      vi.advanceTimersByTime(1000);
      expect(flushes).toHaveLength(1);
    });
  });

  it("flushNow 在没有待处理项时什么都不做", () => {
    withFakeTimers(() => {
      const flushes: string[][] = [];
      const d = new DebouncedSet<string>((s) => flushes.push([...s]), 150, 1000);
      d.flushNow();
      expect(flushes).toEqual([]);
    });
  });

  it("cancel 丢弃待处理项，不触发回调", () => {
    withFakeTimers(() => {
      const flushes: string[][] = [];
      const d = new DebouncedSet<string>((s) => flushes.push([...s]), 150, 1000);
      d.add(["a"]);
      d.cancel();
      vi.advanceTimersByTime(5000);
      expect(flushes).toEqual([]);
      expect(d.pendingSize).toBe(0);
    });
  });
});
