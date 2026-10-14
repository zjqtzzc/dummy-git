import { type Ref, RefKind, UpstreamState } from "@dummy-git/shared";
import { describe, expect, it } from "vitest";
import { refLabels } from "../refLabels.js";

const tracking = { kind: UpstreamState.Tracking, ahead: 0, behind: 0 } as const;
const local = (name: string, target = "c", upstream?: string): Ref => ({
  kind: RefKind.LocalBranch,
  name,
  target,
  ...(upstream === undefined
    ? {}
    : { upstream: { remote: "origin", name: upstream, state: tracking } }),
});
const remote = (name: string, target = "c"): Ref => ({
  kind: RefKind.RemoteBranch,
  remote: "origin",
  name,
  target,
});
const tag = (name: string, target = "c"): Ref => ({
  kind: RefKind.Tag,
  name,
  target,
  annotated: false,
});
const head = (target = "c", branch?: string): Ref => ({
  kind: RefKind.Head,
  target,
  ...(branch === undefined ? {} : { branch }),
});

const names = (refs: readonly Ref[], hash = "c") =>
  refLabels(refs)
    .get(hash)
    ?.map((label) => label.name);

describe("refLabels", () => {
  it("顺序：当前分支 → main → origin/main → 本地 → 远程 → tag，同类按名字", () => {
    const refs = [
      tag("v1"),
      remote("zeta"),
      local("b"),
      remote("main"),
      local("main"),
      local("a"),
      local("topic"),
      head("c", "topic"),
    ];
    expect(names(refs)).toEqual(["topic", "main", "origin/main", "a", "b", "origin/zeta", "v1"]);
  });

  it("detached HEAD 排第一；指着分支的 HEAD 不单独出标签", () => {
    expect(names([local("main"), head()])).toEqual(["HEAD", "main"]);
    expect(names([local("main"), head("c", "main")])).toEqual(["main"]);
  });

  it("当前分支标出来", () => {
    const labels = refLabels([local("main"), local("dev"), head("c", "dev")]).get("c");
    expect(labels?.map((label) => label.current)).toEqual([true, false]);
  });

  it("本地分支与它跟踪的远程分支在同一个提交上：合成「远程 & 本地」，提示里带上远程分支", () => {
    const labels = refLabels([local("dev", "c", "feature"), remote("feature")]).get("c");
    expect(labels).toEqual([
      {
        kind: RefKind.LocalBranch,
        name: "origin & dev",
        title: "dev ↔ origin/feature",
        current: false,
      },
    ]);
  });

  it("跟踪的远程分支在别的提交上：各显示各的", () => {
    const labels = refLabels([local("main", "c", "main"), remote("main", "old")]);
    expect(labels.get("c")?.map((label) => label.title)).toEqual(["main"]);
    expect(labels.get("old")?.map((label) => label.name)).toEqual(["origin/main"]);
  });

  it("超过 22 个字：第一个 / 之前换成 ..；没有 / 的不动", () => {
    const long = "feature/a-very-long-branch-name";
    const labels = refLabels([local(long), local("a-very-long-name-without-slash")]).get("c");
    expect(labels?.map((label) => label.name)).toEqual([
      "a-very-long-name-without-slash",
      "../a-very-long-branch-name",
    ]);
    expect(labels?.at(1)?.title).toBe(long);
  });
});
