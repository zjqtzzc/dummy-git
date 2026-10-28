import { type CommitFileChange, FileStatus, MenuContextKey, type Stash } from "@dummy-git/shared";
import { describe, expect, it } from "vitest";
import type { TreeNode } from "../../tree/tree.js";
import {
  type StashFiles,
  stashByNodeId,
  stashFilesById,
  stashMenuContext,
  stashMenuTargets,
  stashTreeNodes,
} from "../stashTree.js";

const stash = (hash: string, extra: Partial<Stash> = {}): Stash => ({
  hash,
  base: `${hash}-base`,
  message: `WIP on main: ${hash}`,
  at: 0,
  ...extra,
});
const modified = (path: string): CommitFileChange => ({ path, status: FileStatus.Modified });
const added = (path: string): CommitFileChange => ({ path, status: FileStatus.Added });
const renamed = (oldPath: string, path: string): CommitFileChange => ({
  path,
  oldPath,
  status: FileStatus.Renamed,
});

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
    const nodes = stashTreeNodes(list, false, 0, true);
    expect(nodes.map((n) => n.label)).toEqual(["WIP on main: s1", "WIP on main: s2"]);
    const all = ids(nodes);
    expect(all).toContain("s1/src/a.ts");
    expect(all).toContain("s2/src/a.ts");
    expect(all).toContain("s1/new.txt");
    expect(new Set(all).size).toBe(all.length);
  });

  it("时间写在说明位置，写法与 Log 一样", () => {
    const [first] = stashTreeNodes(
      [{ stash: stash("s2", { at: 1000 }), tracked: [], untracked: [] }],
      false,
      1030,
      true,
    );
    expect(first?.description).toBe("just now");
  });
});

describe("stashByNodeId", () => {
  it("stash 那一行和它下面的每一行都属于这条 stash", () => {
    const owners = stashByNodeId(
      stashTreeNodes(
        [
          { stash: stash("s1"), tracked: [modified("src/a.ts")], untracked: [] },
          { stash: stash("s2"), tracked: [modified("b")], untracked: [] },
        ],
        false,
        0,
        true,
      ),
    );
    expect(owners.get("s1")).toBe("s1");
    expect(owners.get("s1/src")).toBe("s1");
    expect(owners.get("s1/src/a.ts")).toBe("s1");
    expect(owners.get("s2/b")).toBe("s2");
  });
});

describe("stashMenuContext", () => {
  const list: StashFiles[] = [
    {
      stash: stash("s1", { untracked: "u1" }),
      tracked: [modified("a"), renamed("old", "new"), modified("src/x")],
      untracked: [added("n")],
    },
    { stash: stash("s2"), tracked: [modified("b")], untracked: [] },
  ];
  const targets = stashMenuTargets(list);
  /** 点中的节点 id 与展开后的叶子 id → 两种看法；目录不在 `targets` 里，是 `null`。 */
  const views = (exact: string[], expanded: string[] = exact) => {
    const at = (ids: string[]) => ids.map((id) => targets.get(id) ?? null);
    return { exact: at(exact), expanded: at(expanded) };
  };
  const repo = { [MenuContextKey.Repo]: "/r" };

  it("恰好一条 stash：Pop、Apply、Rename、Delete，没有 Apply Selected Files", () => {
    expect(stashMenuContext(views(["s1"], ["s1/a", "s1/new", "s1/src/x", "s1/n"]), "/r")).toEqual({
      ...repo,
      [MenuContextKey.PopStash]: { hash: "s1" },
      [MenuContextKey.ApplyStash]: { hash: "s1" },
      [MenuContextKey.RenameStash]: { hash: "s1" },
      [MenuContextKey.DropStash]: { hash: "s1" },
    });
  });

  it("多选两条 stash：没有这些项", () => {
    expect(stashMenuContext(views(["s1", "s2"], ["s1/a", "s2/b"]), "/r")).toEqual(repo);
  });

  it("stash 下的文件：只有 Apply Selected Files；已跟踪与未跟踪分开，改名两头都在", () => {
    expect(stashMenuContext(views(["s1/a", "s1/new", "s1/n"]), "/r")).toEqual({
      ...repo,
      [MenuContextKey.ApplyStashFiles]: {
        hash: "s1",
        paths: ["a", "old", "new"],
        untracked: ["n"],
      },
    });
  });

  it("目录等于它下面的全部文件", () => {
    expect(stashMenuContext(views(["s1/src"], ["s1/src/x"]), "/r")).toEqual({
      ...repo,
      [MenuContextKey.ApplyStashFiles]: { hash: "s1", paths: ["src/x"], untracked: [] },
    });
  });

  it("文件跨了两条 stash、或混着 stash 那一行：没有", () => {
    expect(stashMenuContext(views(["s1/a", "s2/b"]), "/r")).toEqual(repo);
    expect(stashMenuContext(views(["s2", "s1/a"], ["s2/b", "s1/a"]), "/r")).toEqual(repo);
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
