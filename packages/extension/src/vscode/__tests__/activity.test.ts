import { describe, expect, it } from "vitest";
import { Activity } from "../activity.js";

/** 一个手动结束的任务。 */
function pending() {
  let finish: () => void = () => {};
  let fail: () => void = () => {};
  const promise = new Promise<void>((resolve, reject) => {
    finish = resolve;
    fail = () => reject(new Error("失败"));
  });
  return { promise, finish, fail };
}

describe("Activity", () => {
  it("几个操作重叠时，全部结束才空", async () => {
    const activity = new Activity();
    const fetch = pending();
    const commit = pending();
    const fetching = activity.run("Fetching", () => fetch.promise);
    const committing = activity.run("Committing", () => commit.promise);
    expect(activity.titles).toEqual(["Fetching", "Committing"]);

    fetch.finish();
    await fetching;
    expect(activity.titles).toEqual(["Committing"]);

    commit.finish();
    await committing;
    expect(activity.titles).toEqual([]);
  });

  it("失败的也撤掉，异常原样抛出", async () => {
    const activity = new Activity();
    const push = pending();
    const pushing = activity.run("Pushing", () => push.promise);
    push.fail();
    await expect(pushing).rejects.toThrow("失败");
    expect(activity.titles).toEqual([]);
  });

  it("同名的两个只撤一个", async () => {
    const activity = new Activity();
    const first = pending();
    const second = pending();
    const one = activity.run("Fetching", () => first.promise);
    void activity.run("Fetching", () => second.promise);
    first.finish();
    await one;
    expect(activity.titles).toEqual(["Fetching"]);
  });

  it("开始、结束时通知，订阅者看到的是变化之后的", async () => {
    const activity = new Activity();
    const seen: string[][] = [];
    activity.onDidChange(() => seen.push([...activity.titles]));
    await activity.run("Fetching", async () => {});
    expect(seen).toEqual([["Fetching"], []]);
  });
});
