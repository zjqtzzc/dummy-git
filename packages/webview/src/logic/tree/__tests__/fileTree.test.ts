import { describe, expect, it } from "vitest";
import {
  buildFileTree,
  checkedIds,
  type FileEntry,
  type FileNode,
  FileNodeKind,
  filesById,
  keepChecked,
  toTreeNodes,
} from "../fileTree.js";
import type { TreeNode } from "../tree.js";

const m = (path: string): FileEntry => ({ path, letter: "M", color: "red" });

/** 没有标题的一组，直接铺开。 */
const flat = (entries: readonly FileEntry[]): readonly FileNode[] =>
  buildFileTree([{ id: "all", entries }], true);

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

  it("节点 id 是组的 id 加完整路径", () => {
    const [folder] = flat([m("apps/parser/a.py")]);
    expect(folder?.id).toBe("all/apps/parser");
    expect(folder?.kind === FileNodeKind.Folder && folder.children[0]?.id).toBe(
      "all/apps/parser/a.py",
    );
  });

  it("同一目录、同一文件出现在两组里：id 不撞（Vue 的 key、展开、选中都按 id）", () => {
    const nodes = toTreeNodes(
      buildFileTree(
        [
          { id: "changes", label: "Changes", entries: [m("m/input/a.h"), m("same.txt")] },
          {
            id: "unversioned",
            label: "Unversioned Files",
            entries: [m("m/input/b.cpp"), m("same.txt")],
          },
        ],
        true,
      ),
      false,
    );
    const ids = (list: readonly TreeNode[]): string[] =>
      list.flatMap((node) => [node.id, ...ids(node.children ?? [])]);
    const all = ids(nodes);
    expect(all).toHaveLength(8);
    expect(new Set(all).size).toBe(all.length);
  });

  it("没有文件（比如合并提交）→ 空树", () => {
    expect(flat([])).toEqual([]);
  });

  it("keepEmpty：没有文件也留着组", () => {
    expect(
      outline(
        buildFileTree(
          [{ id: "conflicts", label: "Merging feature", entries: [], keepEmpty: true, detail: "" }],
          true,
        ),
      ),
    ).toEqual(["[Merging feature] (0)"]);
  });

  it("有标题的组画成顶层一行，带文件数，下面各自一棵目录树；空组不画", () => {
    const tree = buildFileTree(
      [
        { id: "changes", label: "Changes", entries: [m("src/a.ts"), m("b.ts")] },
        { id: "conflicts", label: "Conflicts", entries: [] },
        { id: "unversioned", label: "Unversioned Files", entries: [m("src/c.ts")] },
      ],
      true,
    );
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

describe("不可勾选的组", () => {
  it("组与它下面每一层都标不可勾选；其他组不标", () => {
    const nodes = toTreeNodes(
      buildFileTree(
        [
          { id: "conflicts", label: "Conflicts", entries: [m("src/a.ts")], uncheckable: true },
          { id: "changes", label: "Changes", entries: [m("b.ts")] },
        ],
        true,
      ),
      false,
    );
    const flags = (list: readonly TreeNode[]): (boolean | undefined)[] =>
      list.flatMap((node) => [node.uncheckable, ...flags(node.children ?? [])]);
    expect(flags(nodes)).toEqual([true, true, true, undefined, undefined]);
  });

  it("勾选不保留不可勾选组里的路径", () => {
    const kept = keepChecked(new Set(["a.ts", "c.ts"]), [
      { id: "conflicts", label: "Conflicts", entries: [m("c.ts")], uncheckable: true },
      { id: "changes", label: "Changes", entries: [m("a.ts")] },
    ]);
    expect([...kept]).toEqual(["a.ts"]);
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

describe("平铺（不按目录分组）", () => {
  const descriptions = (nodes: readonly TreeNode[]): (string | undefined)[] =>
    nodes.flatMap((node) => [node.description, ...descriptions(node.children ?? [])]);

  it("文件直接列在组下面，没有目录这一层，按路径排", () => {
    const tree = buildFileTree(
      [
        {
          id: "changes",
          label: "Changes",
          entries: [m("z.ts"), m("src/b.ts"), m("a/c.ts"), m("src/a.ts")],
        },
      ],
      false,
    );
    expect(outline(tree)).toEqual(["[Changes] (4)", "  c.ts", "  a.ts", "  b.ts", "  z.ts"]);
  });

  it("灰字只写一种：原来的（冲突类型、改名）优先，没有写所在目录，仓库根下的不写", () => {
    const nodes = toTreeNodes(
      buildFileTree(
        [
          {
            id: "all",
            entries: [
              { ...m("src/a.ts"), description: "both modified" },
              { ...m("src/b.ts"), oldPath: "src/old.ts" },
              m("src/c.ts"),
              m("d.ts"),
            ],
          },
        ],
        false,
      ),
      false,
    );
    expect(descriptions(nodes)).toEqual([undefined, "both modified", "renamed from old.ts", "src"]);
  });

  it("按目录分组时文件后面不写目录", () => {
    const nodes = toTreeNodes(
      buildFileTree([{ id: "all", entries: [m("src/c.ts")] }], true),
      false,
    );
    expect(descriptions(nodes)).toEqual(["1 file", undefined]);
  });
});

describe("filesById / checkedIds：节点 id 与路径互换", () => {
  const nodes = buildFileTree(
    [
      {
        id: "changes",
        label: "Changes",
        entries: [{ ...m("same.txt"), letter: "D" }, m("src/a.ts")],
      },
      {
        id: "unversioned",
        label: "Unversioned Files",
        entries: [{ ...m("same.txt"), letter: "U" }],
      },
    ],
    true,
  );
  const files = filesById(nodes);

  it("只收文件，id 换回各自那一组的文件", () => {
    expect([...files.keys()]).toEqual([
      "changes/src/a.ts",
      "changes/same.txt",
      "unversioned/same.txt",
    ]);
    expect(files.get("unversioned/same.txt")).toMatchObject({
      group: "unversioned",
      entry: { letter: "U" },
    });
  });

  it("勾选的路径在几组里各有一行，几行都勾上", () => {
    expect([...checkedIds(files, new Set(["same.txt"]))]).toEqual([
      "changes/same.txt",
      "unversioned/same.txt",
    ]);
  });
});
