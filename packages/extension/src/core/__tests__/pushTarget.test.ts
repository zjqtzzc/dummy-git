import { UpstreamState } from "@dummy-git/shared";
import { describe, expect, it } from "vitest";
import { defaultPushTarget } from "../pushTarget.js";

const upstream = {
  remote: "upstream",
  name: "dev",
  state: { kind: UpstreamState.Tracking, ahead: 1, behind: 0 },
} as const;

describe("defaultPushTarget：上游 → origin → 第一个远程", () => {
  it("有上游：推到上游，不管有几个远程", () => {
    expect(defaultPushTarget("feat", upstream, ["origin", "upstream"])).toEqual({
      remote: "upstream",
      remoteBranch: "dev",
    });
  });

  it("上游已删（gone）：照样推到原来的上游", () => {
    const gone = { ...upstream, state: { kind: UpstreamState.Gone } } as const;
    expect(defaultPushTarget("feat", gone, [])).toEqual({
      remote: "upstream",
      remoteBranch: "dev",
    });
  });

  it("没有上游、多个远程：用 origin，推到同名", () => {
    expect(defaultPushTarget("feat", undefined, ["fork", "origin"])).toEqual({
      remote: "origin",
      remoteBranch: "feat",
    });
  });

  it("没有上游、没有 origin：用第一个远程", () => {
    expect(defaultPushTarget("feat", undefined, ["b", "a"])).toEqual({
      remote: "b",
      remoteBranch: "feat",
    });
  });

  it("一个远程都没有：origin（定义远程时预填的名字）", () => {
    expect(defaultPushTarget("feat", undefined, [])).toEqual({
      remote: "origin",
      remoteBranch: "feat",
    });
  });
});
