import { UpstreamState } from "@dummy-git/shared";
import { describe, expect, it } from "vitest";
import { defaultPushTarget, PushTargetKind } from "../pushTarget.js";

const upstream = {
  remote: "upstream",
  name: "dev",
  state: { kind: UpstreamState.Tracking, ahead: 1, behind: 0 },
} as const;

describe("defaultPushTarget：上游 → 唯一的远程 → origin → 选不出来", () => {
  it("有上游：推到上游，不管有几个远程", () => {
    expect(defaultPushTarget("feat", upstream, ["origin", "upstream"])).toEqual({
      kind: PushTargetKind.Target,
      remote: "upstream",
      remoteBranch: "dev",
    });
  });

  it("上游已删（gone）：照样推到原来的上游", () => {
    const gone = { ...upstream, state: { kind: UpstreamState.Gone } } as const;
    expect(defaultPushTarget("feat", gone, [])).toMatchObject({
      remote: "upstream",
      remoteBranch: "dev",
    });
  });

  it("没有上游、只有一个远程：用它，推到同名——哪怕它不叫 origin", () => {
    expect(defaultPushTarget("feat", undefined, ["github"])).toEqual({
      kind: PushTargetKind.Target,
      remote: "github",
      remoteBranch: "feat",
    });
  });

  it("没有上游、多个远程：用 origin", () => {
    expect(defaultPushTarget("feat", undefined, ["fork", "origin"])).toMatchObject({
      remote: "origin",
    });
  });

  it("多个远程且没有 origin：选不出来", () => {
    expect(defaultPushTarget("feat", undefined, ["a", "b"])).toEqual({
      kind: PushTargetKind.Ambiguous,
    });
  });

  it("没有远程", () => {
    expect(defaultPushTarget("feat", undefined, [])).toEqual({ kind: PushTargetKind.NoRemote });
  });
});
