import { type CommitFileChange, FileStatus } from "@dummy-git/shared";
import { describe, expect, it } from "vitest";
import { buildFileTree, type FileNode, FileNodeKind } from "../fileTree.js";

const m = (path: string): CommitFileChange => ({ path, status: FileStatus.Modified });

/** 树 → 缩进文本。目录写 `名字/ (N)`，改名写 `← 旧名`。 */
function outline(nodes: readonly FileNode[], depth = 0): string[] {
  return nodes.flatMap((node) => {
    const pad = "  ".repeat(depth);
    if (node.kind === FileNodeKind.Folder) {
      return [`${pad}${node.label}/ (${node.count})`, ...outline(node.children, depth + 1)];
    }
    return [`${pad}${node.label}${node.renamedFrom === undefined ? "" : ` ← ${node.renamedFrom}`}`];
  });
}

describe("buildFileTree", () => {
  it("目录在前、各按名字排序、目录带文件数", () => {
    expect(outline(buildFileTree([m("z.ts"), m("src/b.ts"), m("src/a.ts"), m("a.ts")]))).toEqual([
      "src/ (2)",
      "  a.ts",
      "  b.ts",
      "a.ts",
      "z.ts",
    ]);
  });

  it("单子目录链合并成一行，文件数算到最深处", () => {
    expect(
      outline(
        buildFileTree([m("apps/parser/a.py"), m("apps/parser/b.py"), m("apps/parser/sub/c.py")]),
      ),
    ).toEqual(["apps/parser/ (3)", "  sub/ (1)", "    c.py", "  a.py", "  b.py"]);
  });

  it("目录里既有文件又有子目录时不合并", () => {
    expect(outline(buildFileTree([m("a/x.ts"), m("a/b/y.ts")]))).toEqual([
      "a/ (2)",
      "  b/ (1)",
      "    y.ts",
      "  x.ts",
    ]);
  });

  it("改名：同一目录写旧文件名，换了目录写旧的完整路径", () => {
    const tree = buildFileTree([
      { path: "d/new.ts", oldPath: "d/old.ts", status: FileStatus.Renamed },
      { path: "e/moved.ts", oldPath: "f/moved.ts", status: FileStatus.Renamed },
    ]);
    expect(outline(tree)).toEqual([
      "d/ (1)",
      "  new.ts ← old.ts",
      "e/ (1)",
      "  moved.ts ← f/moved.ts",
    ]);
  });

  it("节点 id 是相对仓库根的完整路径", () => {
    const [folder] = buildFileTree([m("apps/parser/a.py")]);
    expect(folder?.id).toBe("apps/parser");
    expect(folder?.kind === FileNodeKind.Folder && folder.children[0]?.id).toBe("apps/parser/a.py");
  });

  it("没有文件（比如合并提交）→ 空树", () => {
    expect(buildFileTree([])).toEqual([]);
  });
});
