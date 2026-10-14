import { type Ref, RefKind, UpstreamState } from "@dummy-git/shared";
import { describe, expect, it } from "vitest";
import {
  type BranchNode,
  BranchNodeKind,
  branchFilterOf,
  branchFilters,
  branchNodesById,
  buildBranchTree,
  DeleteTargetKind,
  defaultExpanded,
  deleteTargetOf,
  localBranchOf,
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

describe("localBranchOf：选中的是不是本地分支", () => {
  const tree = buildBranchTree([
    head("main"),
    local("main"),
    local("feat/x"),
    remote("origin", "main"),
  ]);
  const byId = branchNodesById(tree);
  const of = (id: string) => {
    const node = byId.get(id);
    if (node === undefined) throw new Error(`没有 ${id}`);
    return localBranchOf(node);
  };

  it("本地分支：给出全名", () => {
    expect(of("local/main")).toBe("main");
    expect(of("local/feat/x")).toBe("feat/x");
  });

  it("HEAD 那行代表当前分支；detached 时不是", () => {
    expect(of("head")).toBe("main");
    const detached = branchNodesById(buildBranchTree([head(), local("main")])).get("head");
    expect(detached && localBranchOf(detached)).toBeUndefined();
  });

  it("远程分支、目录、分组都不是", () => {
    expect(of("remote/origin/main")).toBeUndefined();
    expect(of("local/feat")).toBeUndefined();
    expect(of("local")).toBeUndefined();
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
