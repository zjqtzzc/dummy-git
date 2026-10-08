import { type CommitFileChange, FileStatus, type Stash } from "@dummy-git/shared";
import { describe, expect, it } from "vitest";
import type { TreeNode } from "../../tree/tree.js";
import { type StashFiles, stashFilesById, stashTreeNodes } from "../stashTree.js";

const stash = (hash: string, extra: Partial<Stash> = {}): Stash => ({
  hash,
  base: `${hash}-base`,
  message: `WIP on main: ${hash}`,
  at: 0,
  ...extra,
});
const modified = (path: string): CommitFileChange => ({ path, status: FileStatus.Modified });
const added = (path: string): CommitFileChange => ({ path, status: FileStatus.Added });

/** 树 → 每行「id」，看得清结构与 id。 */
function ids(nodes: readonly TreeNode[]): string[] {
  return nodes.flatMap((node) => [node.id, ...ids(node.children ?? [])]);
}

describe("stashTreeNodes", () => {
  const list: StashFiles[] = [
    {
      stash: stash("s1", { untracked: "u1" }),
      tracked: [modified("src/a.ts")],
      untracked: [added("new.txt")],
    },
    { stash: stash("s2"), tracked: [modified("src/a.ts")], untracked: [] },
  ];

  it("每条 stash 一个顶层节点，标题是说明；同一文件在两条里 id 不撞", () => {
    const nodes = stashTreeNodes(list, false, 0);
    expect(nodes.map((n) => n.label)).toEqual(["WIP on main: s1", "WIP on main: s2"]);
    const all = ids(nodes);
    expect(all).toContain("s1/src/a.ts");
    expect(all).toContain("s2/src/a.ts");
    expect(all).toContain("s1/new.txt");
    expect(new Set(all).size).toBe(all.length);
  });

  it("时间写在说明位置，写法与 Log 一样", () => {
    const [first] = stashTreeNodes(
      [{ ...list[1], stash: stash("s2", { at: 1000 }) } as StashFiles],
      false,
      1030,
    );
    expect(first?.description).toBe("just now");
  });
});

describe("stashFilesById", () => {
  it("已跟踪的对存时所在的提交；未跟踪的对附属提交、没有父提交", () => {
    const index = stashFilesById([
      {
        stash: stash("s1", { untracked: "u1" }),
        tracked: [modified("a")],
        untracked: [added("n")],
      },
    ]);
    expect(index.get("s1/a")).toEqual({ hash: "s1", parents: ["s1-base"], file: modified("a") });
    expect(index.get("s1/n")).toEqual({ hash: "u1", parents: [], file: added("n") });
  });
});
