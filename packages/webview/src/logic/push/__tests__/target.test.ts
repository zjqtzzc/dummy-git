import { type Ref, RefKind } from "@dummy-git/shared";
import { describe, expect, it } from "vitest";
import { isNewRemoteBranch } from "../target.js";

const refs: Ref[] = [
  { kind: RefKind.LocalBranch, name: "feat", target: "a" },
  { kind: RefKind.RemoteBranch, remote: "origin", name: "main", target: "b" },
  { kind: RefKind.RemoteBranch, remote: "fork", name: "feat", target: "c" },
];

describe("isNewRemoteBranch", () => {
  it("那个远程上有同名分支：不是新的", () => {
    expect(isNewRemoteBranch(refs, "origin", "main")).toBe(false);
  });

  it("只有别的远程上有、或只有本地分支同名：是新的", () => {
    expect(isNewRemoteBranch(refs, "origin", "feat")).toBe(true);
  });
});
