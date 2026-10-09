import { type Commit, RefKind } from "@dummy-git/shared";
import { describe, expect, it } from "vitest";
import { branchNodesById, buildBranchTree } from "../branchTree.js";
import { branchCopyText, commitCopyText } from "../copy.js";

const T = "a".repeat(40);
const at = new Date(2026, 8, 20, 9, 5).getTime() / 1000;
const commit = (message: string, email: string): Commit => ({
  hash: T,
  parents: [],
  author: { name: "Ann", email, at },
  committer: { name: "Ann", email, at },
  message,
});

describe("commitCopyText", () => {
  it("完整说明、空一行、作者与绝对日期", () => {
    expect(commitCopyText(commit("fix login\n\nbody line\n", "a@x"))).toBe(
      "fix login\n\nbody line\n\nAuthor: Ann <a@x>\nDate: 2026/9/20 09:05",
    );
  });

  it("邮箱为空时只写名字", () => {
    expect(commitCopyText(commit("m", ""))).toBe("m\n\nAuthor: Ann\nDate: 2026/9/20 09:05");
  });
});

describe("branchCopyText", () => {
  const byId = branchNodesById(
    buildBranchTree([
      { kind: RefKind.Head, target: T, branch: "main" },
      { kind: RefKind.LocalBranch, name: "feat/x", target: T },
      { kind: RefKind.RemoteBranch, remote: "origin", name: "main", target: T },
    ]),
  );
  const of = (id: string) => {
    const node = byId.get(id);
    return node === undefined ? "missing" : branchCopyText(node);
  };

  it("本地全名、远程带远程名、HEAD 行是当前分支；目录与分组没有", () => {
    expect(of("local/feat/x")).toBe("feat/x");
    expect(of("remote/origin/main")).toBe("origin/main");
    expect(of("head")).toBe("main");
    expect(of("local/feat")).toBeUndefined();
    expect(of("local")).toBeUndefined();
  });

  it("detached 的 HEAD 是完整 hash", () => {
    const detached = branchNodesById(buildBranchTree([{ kind: RefKind.Head, target: T }])).get(
      "head",
    );
    expect(detached && branchCopyText(detached)).toBe(T);
  });
});
