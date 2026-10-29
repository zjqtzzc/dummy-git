import { type Ref, RefKind, type Upstream, UpstreamState } from "@dummy-git/shared";
import { describe, expect, it } from "vitest";
import { branchStatus } from "../branchStatus.js";

const target = "9c487b97".padEnd(40, "0");

function onMain(upstream?: Upstream): Ref[] {
  return [
    { kind: RefKind.Head, target, branch: "main" },
    { kind: RefKind.LocalBranch, name: "dev", target },
    upstream === undefined
      ? { kind: RefKind.LocalBranch, name: "main", target }
      : { kind: RefKind.LocalBranch, name: "main", target, upstream },
  ];
}

function tracking(ahead: number, behind: number): Upstream {
  return { remote: "origin", name: "main", state: { kind: UpstreamState.Tracking, ahead, behind } };
}

describe("branchStatus", () => {
  it("detached HEAD 显示短 hash", () => {
    expect(branchStatus([{ kind: RefKind.Head, target }])).toBe("$(git-commit) 9c487b9");
  });

  it("没有上游、已同步、上游已删都只显示分支名", () => {
    const quiet = "$(git-branch) main";
    expect(branchStatus(onMain())).toBe(quiet);
    expect(branchStatus(onMain(tracking(0, 0)))).toBe(quiet);
    expect(
      branchStatus(onMain({ remote: "origin", name: "main", state: { kind: UpstreamState.Gone } })),
    ).toBe(quiet);
  });

  it("落后、领先、分叉各带箭头", () => {
    expect(branchStatus(onMain(tracking(0, 2)))).toBe("$(git-branch) main ↓2");
    expect(branchStatus(onMain(tracking(3, 0)))).toBe("$(git-branch) main ↑3");
    expect(branchStatus(onMain(tracking(1, 2)))).toBe("$(git-branch) main ↓2↑1");
  });

  it("上游取当前分支的，不取别的分支", () => {
    const refs: Ref[] = [
      { kind: RefKind.Head, target, branch: "main" },
      { kind: RefKind.LocalBranch, name: "dev", target, upstream: tracking(5, 5) },
      { kind: RefKind.LocalBranch, name: "main", target },
    ];
    expect(branchStatus(refs)).toBe("$(git-branch) main");
  });
});
