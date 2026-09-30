import { type Ref, RefKind } from "@dummy-git/shared";
import { describe, expect, it } from "vitest";
import {
  type BranchNode,
  BranchNodeKind,
  buildBranchTree,
  defaultExpanded,
  restoreExpanded,
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
