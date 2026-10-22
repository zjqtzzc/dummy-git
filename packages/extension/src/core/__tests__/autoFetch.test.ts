import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTO_FETCH_INTERVAL_MS, startAutoFetch } from "../autoFetch.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("startAutoFetch", () => {
  it("先跑一次，之后每次跑完隔一个间隔再跑；停掉后不再跑", async () => {
    let runs = 0;
    const auto = startAutoFetch(
      async () => {
        runs += 1;
      },
      () => undefined,
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(runs).toBe(1);
    await vi.advanceTimersByTimeAsync(AUTO_FETCH_INTERVAL_MS - 1);
    expect(runs).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(runs).toBe(2);
    auto.dispose();
    await vi.advanceTimersByTimeAsync(AUTO_FETCH_INTERVAL_MS * 3);
    expect(runs).toBe(2);
  });

  it("失败交给 onError，不往外抛，下一次照常跑", async () => {
    const errors: unknown[] = [];
    let runs = 0;
    const auto = startAutoFetch(
      async () => {
        runs += 1;
        throw new Error("offline");
      },
      (cause) => errors.push(cause),
    );
    await vi.advanceTimersByTimeAsync(AUTO_FETCH_INTERVAL_MS);
    expect(runs).toBe(2);
    expect(errors).toHaveLength(2);
    auto.dispose();
  });

  it("上一次没跑完不叠着跑：间隔从跑完时算起", async () => {
    let finish: () => void = () => undefined;
    let runs = 0;
    const auto = startAutoFetch(
      () => {
        runs += 1;
        return new Promise<void>((resolve) => {
          finish = resolve;
        });
      },
      () => undefined,
    );
    await vi.advanceTimersByTimeAsync(AUTO_FETCH_INTERVAL_MS * 2);
    expect(runs).toBe(1);
    finish();
    await vi.advanceTimersByTimeAsync(AUTO_FETCH_INTERVAL_MS);
    expect(runs).toBe(2);
    auto.dispose();
  });
});
