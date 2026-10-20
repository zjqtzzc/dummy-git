import { MenuContextKey, type Ref, RefKind, UpstreamState } from "@dummy-git/shared";
import { describe, expect, it } from "vitest";
import {
  type BranchNode,
  BranchNodeKind,
  branchFilterOf,
  branchFilters,
  branchMenuContext,
  branchNodesById,
  branchViews,
  buildBranchTree,
  DeleteTargetKind,
  defaultExpanded,
  deleteTargetOf,
  restoreExpanded,
  startOf,
  TrackingKind,
  trackingOf,
} from "../branchTree.js";

const T = "a".repeat(40);
const local = (name: string): Ref => ({ kind: RefKind.LocalBranch, name, target: T });
const remote = (r: string, name: string): Ref => ({
  kind: RefKind.RemoteBranch,
  remote: r,
  name,
  target: T,
});
const head = (branch?: string): Ref =>
  branch === undefined
    ? { kind: RefKind.Head, target: T }
    : { kind: RefKind.Head, target: T, branch };

/** 树 → 缩进文本，断言看得清结构。当前分支标 `*`。 */
function outline(nodes: readonly BranchNode[], depth = 0): string[] {
  return nodes.flatMap((node) => {
    const pad = "  ".repeat(depth);
    switch (node.kind) {
      case BranchNodeKind.Head:
        return [`${pad}${node.label}`];
      case BranchNodeKind.Branch:
        return [`${pad}${node.label}${node.current ? " *" : ""}`];
      default:
        return [`${pad}${node.label}/`, ...outline(node.children, depth + 1)];
    }
  });
}

describe("buildBranchTree", () => {
  it("HEAD 行、Local、Remote；按 / 折叠，目录在前，各层按名字排序", () => {
    const tree = buildBranchTree([
      head("main"),
      local("main"),
      local("feat/b"),
      local("feat/a"),
      local("dev"),
      remote("origin", "main"),
      remote("origin", "feat/x"),
      remote("upstream", "main"),
    ]);
    expect(outline(tree)).toEqual([
      "HEAD → main",
      "Local/",
      "  feat/",
      "    a",
      "    b",
      "  dev",
      "  main *",
      "Remote/",
      "  origin/",
      "    feat/",
      "      x",
      "    main",
      "  upstream/",
      "    main",
    ]);
  });

  it("detached：HEAD 行写短 hash，没有分支标成当前", () => {
    const tree = buildBranchTree([head(), local("main")]);
    expect(outline(tree)).toEqual([
      `HEAD (detached at ${T.slice(0, 7)})`,
      "Local/",
      "  main",
      "Remote/",
    ]);
  });

  it("不显示 origin/HEAD——它只是指针，不是分支", () => {
    const tree = buildBranchTree([remote("origin", "HEAD"), remote("origin", "main")]);
    expect(outline(tree)).toEqual(["Local/", "Remote/", "  origin/", "    main"]);
  });

  it("当前分支在目录里：按全名匹配，同名的叶子不会误标", () => {
    const tree = buildBranchTree([head("feat/x"), local("feat/x"), local("x")]);
    expect(outline(tree)).toEqual([
      "HEAD → feat/x",
      "Local/",
      "  feat/",
      "    x *",
      "  x",
      "Remote/",
    ]);
  });
});

describe("defaultExpanded", () => {
  it("两组与各远程名展开，/ 目录折叠", () => {
    const tree = buildBranchTree([local("feat/a"), remote("origin", "feat/x")]);
    expect([...defaultExpanded(tree)].sort()).toEqual(["local", "remote", "remote/origin"]);
  });

  it("当前分支所在的每层目录都展开，否则打开就看不见它", () => {
    const tree = buildBranchTree([head("a/b/c"), local("a/b/c"), local("z/y")]);
    const open = defaultExpanded(tree);
    expect(open.has("local/a")).toBe(true);
    expect(open.has("local/a/b")).toBe(true);
    expect(open.has("local/z")).toBe(false);
  });
});

describe("restoreExpanded", () => {
  it("字符串数组 → 集合；其它 → undefined，用默认值", () => {
    expect(restoreExpanded(["local", "remote/origin"])).toEqual(
      new Set(["local", "remote/origin"]),
    );
    expect(restoreExpanded(undefined)).toBeUndefined();
    expect(restoreExpanded([1, 2])).toBeUndefined();
  });
});

describe("deleteTargetOf：选中的能不能删", () => {
  const byId = branchNodesById(
    buildBranchTree([head("main"), local("main"), local("feat/x"), remote("origin", "feat/x")]),
  );
  const of = (id: string) => {
    const node = byId.get(id);
    if (node === undefined) throw new Error(`没有 ${id}`);
    return deleteTargetOf(node);
  };

  it("非当前的本地分支、远程分支：能删", () => {
    expect(of("local/feat/x")).toEqual({ kind: DeleteTargetKind.Local, branch: "feat/x" });
    expect(of("remote/origin/feat/x")).toEqual({
      kind: DeleteTargetKind.Remote,
      remote: "origin",
      branch: "feat/x",
    });
  });

  it("当前分支、HEAD 行、目录、分组：不能删", () => {
    expect(of("local/main")).toBeUndefined();
    expect(of("head")).toBeUndefined();
    expect(of("local/feat")).toBeUndefined();
    expect(of("remote")).toBeUndefined();
  });
});

describe("startOf：新分支的起点", () => {
  const tree = buildBranchTree([head("main"), local("main"), remote("origin", "feat/x")]);
  const byId = branchNodesById(tree);
  const of = (id: string) => {
    const node = byId.get(id);
    if (node === undefined) throw new Error(`没有 ${id}`);
    return startOf(node);
  };

  it("分支给完整引用名，不让 git 在同名的本地与远程分支之间猜", () => {
    expect(of("local/main")).toEqual({ start: "refs/heads/main", name: "main" });
    expect(of("remote/origin/feat/x")).toEqual({
      start: "refs/remotes/origin/feat/x",
      name: "origin/feat/x",
    });
  });

  it("HEAD 那行：在分支上给分支，detached 给提交", () => {
    expect(of("head")).toEqual({ start: "refs/heads/main", name: "main" });
    const detached = branchNodesById(buildBranchTree([head()])).get("head");
    expect(detached && startOf(detached)).toEqual({ start: T, name: T.slice(0, 7) });
  });

  it("目录、分组不能当起点", () => {
    expect(of("remote/origin/feat")).toBeUndefined();
    expect(of("local")).toBeUndefined();
  });
});

describe("按分支过滤", () => {
  const refs = [
    head("main"),
    local("main"),
    local("feat/x"),
    remote("origin", "HEAD"),
    remote("origin", "main"),
  ];

  it("branchFilters：本地在前、远程在后，完整引用名，不含 origin/HEAD", () => {
    expect(branchFilters(refs)).toEqual([
      { ref: "refs/heads/feat/x", name: "feat/x" },
      { ref: "refs/heads/main", name: "main" },
      { ref: "refs/remotes/origin/main", name: "origin/main" },
    ]);
  });

  it("branchFilterOf：分支与 HEAD 行是分支；detached、目录、分组不是", () => {
    const byId = branchNodesById(buildBranchTree(refs));
    const of = (id: string) => {
      const node = byId.get(id);
      return node === undefined ? "missing" : branchFilterOf(node);
    };
    expect(of("head")).toEqual({ ref: "refs/heads/main", name: "main" });
    expect(of("remote/origin/main")).toEqual({
      ref: "refs/remotes/origin/main",
      name: "origin/main",
    });
    expect(of("local/feat")).toBeUndefined();
    const detached = branchNodesById(buildBranchTree([head(), local("main")])).get("head");
    expect(detached && branchFilterOf(detached)).toBeUndefined();
  });
});

describe("trackingOf：分支名后面的同步状态", () => {
  const tracked = (name: string, ahead: number, behind: number): Ref => ({
    kind: RefKind.LocalBranch,
    name,
    target: T,
    upstream: {
      remote: "origin",
      name,
      state: { kind: UpstreamState.Tracking, ahead, behind },
    },
  });
  const gone: Ref = {
    kind: RefKind.LocalBranch,
    name: "old",
    target: T,
    upstream: { remote: "origin", name: "old", state: { kind: UpstreamState.Gone } },
  };
  const byId = branchNodesById(
    buildBranchTree([
      head("main"),
      tracked("main", 2, 1),
      tracked("synced", 0, 0),
      gone,
      local("lonely"),
      remote("origin", "main"),
    ]),
  );
  const of = (id: string) => {
    const node = byId.get(id);
    if (node === undefined) throw new Error(`没有 ${id}`);
    return trackingOf(node);
  };

  it("领先 / 落后：两边的数", () => {
    expect(of("local/main")).toEqual({ kind: TrackingKind.Counts, ahead: 2, behind: 1 });
  });

  it("上游已删：gone", () => {
    expect(of("local/old")).toEqual({ kind: TrackingKind.Gone });
  });

  it("完全同步、没有上游、远程分支、HEAD 那行：不显示", () => {
    expect(of("local/synced")).toBeUndefined();
    expect(of("local/lonely")).toBeUndefined();
    expect(of("remote/origin/main")).toBeUndefined();
    expect(of("head")).toBeUndefined();
  });
});

describe("分支树的右键菜单项", () => {
  /** 每个节点单独右键时的菜单上下文：id → 菜单。 */
  function menus(refs: readonly Ref[]): ReadonlyMap<string, Readonly<Record<string, unknown>>> {
    const index = new Map<string, Readonly<Record<string, unknown>>>();
    const nodes = branchNodesById(buildBranchTree(refs));
    for (const id of nodes.keys()) {
      index.set(id, branchMenuContext(branchViews([id], nodes), "/r"));
    }
    return index;
  }
  /** 跟踪 `origin/<name>` 的本地分支：能 Update。 */
  const tracked = (name: string, gone = false): Ref => ({
    kind: RefKind.LocalBranch,
    name,
    target: T,
    upstream: {
      remote: "origin",
      name,
      state: gone
        ? { kind: UpstreamState.Gone }
        : { kind: UpstreamState.Tracking, ahead: 0, behind: 0 },
    },
  });
  const byId = menus([head("main"), tracked("main"), local("feat/x"), remote("origin", "feat/x")]);
  const keysOf = (id: string) => Object.keys(byId.get(id) ?? {}).sort();
  const start = { start: "refs/heads/feat/x", startName: "feat/x" };

  it("别的本地分支（没有上游）：除了 Update 都有，参数是它的名字或起点", () => {
    expect(byId.get("local/feat/x")).toEqual({
      [MenuContextKey.Repo]: "/r",
      [MenuContextKey.Checkout]: { branch: "feat/x" },
      [MenuContextKey.PushBranch]: { branch: "feat/x" },
      [MenuContextKey.MergeBranch]: start,
      [MenuContextKey.RebaseBranch]: start,
      [MenuContextKey.NewBranch]: start,
      [MenuContextKey.RenameBranch]: { branch: "feat/x" },
      [MenuContextKey.DeleteBranches]: { local: ["feat/x"], remote: [] },
    });
  });

  it("当前分支与 HEAD 那行：没有 Checkout、Merge、Rebase、Delete", () => {
    const expected = [
      MenuContextKey.Repo,
      MenuContextKey.UpdateBranch,
      MenuContextKey.PushBranch,
      MenuContextKey.NewBranch,
      MenuContextKey.RenameBranch,
    ].sort();
    expect(keysOf("local/main")).toEqual(expected);
    expect(keysOf("head")).toEqual(expected);
  });

  it("远程分支：Checkout、Merge、Rebase、New Branch、Delete，带远程名", () => {
    expect(byId.get("remote/origin/feat/x")).toMatchObject({
      [MenuContextKey.CheckoutRemote]: { remote: "origin", branch: "feat/x" },
      [MenuContextKey.DeleteBranches]: {
        local: [],
        remote: [{ remote: "origin", branch: "feat/x" }],
      },
    });
    expect(keysOf("remote/origin/feat/x")).toEqual(
      [
        MenuContextKey.Repo,
        MenuContextKey.CheckoutRemote,
        MenuContextKey.MergeBranch,
        MenuContextKey.RebaseBranch,
        MenuContextKey.NewBranch,
        MenuContextKey.DeleteBranches,
      ].sort(),
    );
  });

  it("detached 的 HEAD：只有 New Branch，起点是那条提交", () => {
    expect(menus([head()]).get("head")).toEqual({
      [MenuContextKey.Repo]: "/r",
      [MenuContextKey.NewBranch]: { start: T, startName: T.slice(0, 7) },
    });
  });

  it("Update：配了上游的本地分支，HEAD 那行与当前分支一起选只算一次；上游没了的不行", () => {
    expect(byId.get("local/main")).toHaveProperty(MenuContextKey.UpdateBranch, {
      branches: ["main"],
    });
    const nodes = branchNodesById(
      buildBranchTree([head("main"), tracked("main"), tracked("feat/a"), tracked("feat/b", true)]),
    );
    const update = (ids: readonly string[]) =>
      branchMenuContext(branchViews(ids, nodes), "/r")[MenuContextKey.UpdateBranch];
    expect(update(["head", "local/main"])).toEqual({ branches: ["main"] });
    expect(update(["local/main", "local/feat/a"])).toEqual({ branches: ["main", "feat/a"] });
    expect(update(["local/feat/b"])).toBeUndefined();
    expect(update(["local/feat"])).toBeUndefined();
  });

  it("目录：下面都配了上游的，Update 更新它下面的全部本地分支", () => {
    const nodes = branchNodesById(buildBranchTree([tracked("feat/a"), tracked("feat/b")]));
    expect(branchMenuContext(branchViews(["local/feat"], nodes), "/r")).toHaveProperty(
      MenuContextKey.UpdateBranch,
      { branches: ["feat/a", "feat/b"] },
    );
  });

  it("目录：只有 Delete，删它下面的全部分支", () => {
    expect(byId.get("local/feat")).toEqual({
      [MenuContextKey.Repo]: "/r",
      [MenuContextKey.DeleteBranches]: { local: ["feat/x"], remote: [] },
    });
  });

  it("里面有当前分支的分组：没有 Delete（全部严格）", () => {
    expect(keysOf("local")).toEqual([MenuContextKey.Repo]);
  });

  it("远程名、Remote 组：不给 Delete", () => {
    expect(keysOf("remote/origin")).toEqual([MenuContextKey.Repo]);
    expect(keysOf("remote")).toEqual([MenuContextKey.Repo]);
  });

  it("远程名下面的目录：能删", () => {
    const nodes = branchNodesById(
      buildBranchTree([remote("origin", "feat/a"), remote("origin", "feat/b")]),
    );
    expect(branchMenuContext(branchViews(["remote/origin/feat"], nodes), "/r")).toEqual({
      [MenuContextKey.Repo]: "/r",
      [MenuContextKey.DeleteBranches]: {
        local: [],
        remote: [
          { remote: "origin", branch: "feat/a" },
          { remote: "origin", branch: "feat/b" },
        ],
      },
    });
  });

  it("多选：只能对一个分支做的都不出现；里面有当前分支就没有 Delete", () => {
    const nodes = branchNodesById(
      buildBranchTree([head("main"), local("main"), local("feat/x"), local("y")]),
    );
    expect(branchMenuContext(branchViews(["local/feat/x", "local/y"], nodes), "/r")).toEqual({
      [MenuContextKey.Repo]: "/r",
      [MenuContextKey.DeleteBranches]: { local: ["feat/x", "y"], remote: [] },
    });
    expect(branchMenuContext(branchViews(["local/main", "local/y"], nodes), "/r")).toEqual({
      [MenuContextKey.Repo]: "/r",
    });
  });

  it("目录和它下面的分支一起选：只算一次", () => {
    const nodes = branchNodesById(buildBranchTree([local("feat/x"), local("feat/y")]));
    expect(branchViews(["local/feat", "local/feat/x"], nodes).expanded.map((n) => n.id)).toEqual([
      "local/feat/x",
      "local/feat/y",
    ]);
  });
});
