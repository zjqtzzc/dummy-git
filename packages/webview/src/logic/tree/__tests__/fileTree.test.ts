import { describe, expect, it } from "vitest";
import {
  buildFileTree,
  type FileEntry,
  type FileNode,
  FileNodeKind,
  keepChecked,
} from "../fileTree.js";

const m = (path: string): FileEntry => ({ path, letter: "M", color: "red" });

/** 没有标题的一组，直接铺开。 */
const flat = (entries: readonly FileEntry[]): readonly FileNode[] =>
  buildFileTree([{ id: "all", entries }]);

/** 树 → 缩进文本。目录写 `名字/ (N)`，改名写 `← 旧名`。 */
function outline(nodes: readonly FileNode[], depth = 0): string[] {
  return nodes.flatMap((node) => {
    const pad = "  ".repeat(depth);
    if (node.kind === FileNodeKind.Group) {
      return [`${pad}[${node.label}] (${node.count})`, ...outline(node.children, depth + 1)];
    }
    if (node.kind === FileNodeKind.Folder) {
      return [`${pad}${node.label}/ (${node.count})`, ...outline(node.children, depth + 1)];
    }
    return [`${pad}${node.label}${node.renamedFrom === undefined ? "" : ` ← ${node.renamedFrom}`}`];
  });
}

describe("buildFileTree", () => {
  it("目录在前、各按名字排序、目录带文件数", () => {
    expect(outline(flat([m("z.ts"), m("src/b.ts"), m("src/a.ts"), m("a.ts")]))).toEqual([
      "src/ (2)",
      "  a.ts",
      "  b.ts",
      "a.ts",
      "z.ts",
    ]);
  });

  it("单子目录链合并成一行，文件数算到最深处", () => {
    expect(
      outline(flat([m("apps/parser/a.py"), m("apps/parser/b.py"), m("apps/parser/sub/c.py")])),
    ).toEqual(["apps/parser/ (3)", "  sub/ (1)", "    c.py", "  a.py", "  b.py"]);
  });

  it("目录里既有文件又有子目录时不合并", () => {
    expect(outline(flat([m("a/x.ts"), m("a/b/y.ts")]))).toEqual([
      "a/ (2)",
      "  b/ (1)",
      "    y.ts",
      "  x.ts",
    ]);
  });

  it("改名：同一目录写旧文件名，换了目录写旧的完整路径", () => {
    const tree = flat([
      { ...m("d/new.ts"), oldPath: "d/old.ts" },
      { ...m("e/moved.ts"), oldPath: "f/moved.ts" },
    ]);
    expect(outline(tree)).toEqual([
      "d/ (1)",
      "  new.ts ← old.ts",
      "e/ (1)",
      "  moved.ts ← f/moved.ts",
    ]);
  });

  it("节点 id 是相对仓库根的完整路径", () => {
    const [folder] = flat([m("apps/parser/a.py")]);
    expect(folder?.id).toBe("apps/parser");
    expect(folder?.kind === FileNodeKind.Folder && folder.children[0]?.id).toBe("apps/parser/a.py");
  });

  it("没有文件（比如合并提交）→ 空树", () => {
    expect(flat([])).toEqual([]);
  });

  it("有标题的组画成顶层一行，带文件数，下面各自一棵目录树；空组不画", () => {
    const tree = buildFileTree([
      { id: "changes", label: "Changes", entries: [m("src/a.ts"), m("b.ts")] },
      { id: "conflicts", label: "Conflicts", entries: [] },
      { id: "unversioned", label: "Unversioned Files", entries: [m("src/c.ts")] },
    ]);
    expect(outline(tree)).toEqual([
      "[Changes] (2)",
      "  src/ (1)",
      "    a.ts",
      "  b.ts",
      "[Unversioned Files] (1)",
      "  src/ (1)",
      "    c.ts",
    ]);
  });
});

describe("keepChecked", () => {
  it("刷新后：勾选按路径保持，消失的移出，新文件不勾", () => {
    const kept = keepChecked(new Set(["a.ts", "gone.ts"]), [
      { id: "changes", entries: [m("a.ts"), m("new.ts")] },
    ]);
    expect([...kept]).toEqual(["a.ts"]);
  });
});
