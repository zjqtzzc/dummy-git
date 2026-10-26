import {
  ChangeKind,
  ConflictKind,
  DiffSideKind,
  type FileChange,
  FileStatus,
  MenuContextKey,
  OperationKind,
} from "@dummy-git/shared";
import { describe, expect, it } from "vitest";
import {
  conflictFiles,
  conflictHeading,
  opensMergeEditor,
  rollbackArgs,
  WorkingStatus,
  workingDiffSides,
  workingFiles,
  workingGroups,
  workingMenuContext,
} from "../workingChanges.js";

const tracked = (
  path: string,
  index: FileStatus,
  worktree: FileStatus,
  oldPath?: string,
): FileChange =>
  oldPath === undefined
    ? { kind: ChangeKind.Tracked, path, index, worktree }
    : { kind: ChangeKind.Tracked, path, oldPath, index, worktree };

const U = FileStatus.Unchanged;
const M = FileStatus.Modified;
const A = FileStatus.Added;
const D = FileStatus.Deleted;
const R = FileStatus.Renamed;

describe("workingFiles：只看 HEAD ↔ 工作区，两列合成一个", () => {
  it.each([
    ["已暂存修改", M, U, WorkingStatus.Modified],
    ["未暂存修改", U, M, WorkingStatus.Modified],
    ["两边都改", M, M, WorkingStatus.Modified],
    ["已 add 的新文件", A, U, WorkingStatus.Added],
    ["已 add 又改了", A, M, WorkingStatus.Added],
    ["git add -N", U, A, WorkingStatus.Added],
    ["磁盘上删了", U, D, WorkingStatus.Deleted],
    ["git rm", D, U, WorkingStatus.Deleted],
    ["改了又删", M, D, WorkingStatus.Deleted],
    ["类型改变", FileStatus.TypeChanged, U, WorkingStatus.Modified],
  ])("%s", (_name, index, worktree, expected) => {
    expect(workingFiles([tracked("a.ts", index, worktree)])).toEqual([
      { path: "a.ts", status: expected },
    ]);
  });

  it("add 后又在磁盘上删掉（AD）：HEAD 与工作区都没有，不显示", () => {
    expect(workingFiles([tracked("a.ts", A, D)])).toEqual([]);
  });

  it("改名：带 HEAD 里的旧路径", () => {
    expect(workingFiles([tracked("b.ts", R, M, "a.ts")])).toEqual([
      { path: "b.ts", oldPath: "a.ts", status: WorkingStatus.Renamed },
    ]);
  });

  it("改名后又删掉新路径：算删除 HEAD 里的旧路径", () => {
    expect(workingFiles([tracked("b.ts", R, D, "a.ts")])).toEqual([
      { path: "a.ts", status: WorkingStatus.Deleted },
    ]);
  });

  it("未跟踪照列；冲突另成一组，不在这几组里", () => {
    expect(
      workingFiles([
        { kind: ChangeKind.Untracked, path: "new.txt" },
        { kind: ChangeKind.Conflict, path: "c.ts", conflict: ConflictKind.BothModified },
      ]),
    ).toEqual([{ path: "new.txt", status: WorkingStatus.Untracked }]);
  });
});

describe("workingGroups", () => {
  it("冲突在最上面且不可勾选，已跟踪进 Changes，未跟踪进 Unversioned Files", () => {
    const groups = workingGroups(
      [{ path: "c.ts", conflict: ConflictKind.DeletedByThem }],
      [
        { path: "a.ts", status: WorkingStatus.Modified },
        { path: "new.txt", status: WorkingStatus.Untracked },
      ],
    );
    expect(groups.map((g) => [g.label, g.entries.map((e) => `${e.letter} ${e.path}`)])).toEqual([
      ["Conflicts", ["! c.ts"]],
      ["Changes", ["M a.ts"]],
      ["Unversioned Files", ["U new.txt"]],
    ]);
    expect(groups.map((g) => g.uncheckable === true)).toEqual([true, false, false]);
    expect(groups[0]?.entries[0]?.description).toBe("deleted by them");
  });
});

describe("workingMenuContext：Commit 面板的右键菜单项", () => {
  const conflicts = [
    { path: "c.ts", conflict: ConflictKind.DeletedByThem },
    { path: "m.ts", conflict: ConflictKind.BothModified },
    { path: "d.ts", conflict: ConflictKind.BothDeleted },
  ];
  const files = [
    { path: "a.ts", status: WorkingStatus.Modified },
    { path: "new.txt", status: WorkingStatus.Untracked },
  ];
  /** 选中这些文件（`null` 是一个目录或组，下面什么都不算）：展开看就是这些文件本身。 */
  const menuOf = (...paths: (string | null)[]) => {
    const exact = paths.map((path) => (path === null ? null : { path }));
    const expanded = paths.flatMap((path) => (path === null ? [] : [{ path }]));
    return workingMenuContext("/repo", conflicts, files, { exact, expanded });
  };

  it("各种文件：各自的菜单项，参数是路径", () => {
    expect(menuOf("c.ts")).toEqual({
      [MenuContextKey.Repo]: "/repo",
      [MenuContextKey.OpenFile]: { path: "c.ts" },
      [MenuContextKey.KeepFile]: { paths: ["c.ts"] },
      [MenuContextKey.RemoveConflictFile]: { paths: ["c.ts"] },
    });
    expect(menuOf("m.ts")).toEqual({
      [MenuContextKey.Repo]: "/repo",
      [MenuContextKey.OpenFile]: { path: "m.ts" },
      [MenuContextKey.OpenMergeEditor]: { path: "m.ts" },
      [MenuContextKey.MarkResolved]: { paths: ["m.ts"] },
    });
    expect(menuOf("d.ts")).toEqual({
      [MenuContextKey.Repo]: "/repo",
      [MenuContextKey.RemoveConflictFile]: { paths: ["d.ts"] },
    });
    expect(menuOf("a.ts")).toEqual({
      [MenuContextKey.Repo]: "/repo",
      [MenuContextKey.OpenFile]: { path: "a.ts" },
      [MenuContextKey.RollbackFile]: { paths: ["a.ts"] },
    });
    expect(menuOf("new.txt")).toEqual({
      [MenuContextKey.Repo]: "/repo",
      [MenuContextKey.OpenFile]: { path: "new.txt" },
      [MenuContextKey.AddUntracked]: { paths: ["new.txt"] },
      [MenuContextKey.DeleteUntracked]: { paths: ["new.txt"] },
    });
  });

  it("Open File 打开磁盘上的那个路径：改名打开新路径；删除的、两边都删了的冲突没有", () => {
    const changes = [
      { path: "renamed.ts", oldPath: "old.ts", status: WorkingStatus.Renamed },
      { path: "gone.ts", status: WorkingStatus.Deleted },
      // 改名后又删掉新路径：画成旧路径上的删除。
      { path: "moved-from.ts", status: WorkingStatus.Deleted },
    ];
    const open = (path: string) =>
      workingMenuContext("/repo", conflicts, changes, { exact: [{ path }], expanded: [{ path }] })[
        MenuContextKey.OpenFile
      ];
    expect(open("renamed.ts")).toEqual({ path: "renamed.ts" });
    expect(open("gone.ts")).toBeUndefined();
    expect(open("moved-from.ts")).toBeUndefined();
    expect(open("d.ts")).toBeUndefined();
  });

  it("Open File 只对点中的一个文件：多选、目录都没有", () => {
    const both = [{ path: "a.ts" }, { path: "new.txt" }];
    expect(
      workingMenuContext("/repo", conflicts, files, { exact: both, expanded: both })[
        MenuContextKey.OpenFile
      ],
    ).toBeUndefined();
    const folder = { exact: [null], expanded: [{ path: "a.ts" }] };
    expect(
      workingMenuContext("/repo", conflicts, files, folder)[MenuContextKey.OpenFile],
    ).toBeUndefined();
  });

  it("选中 Unversioned Files 组：Add to Git、Delete 作用于下面全部未跟踪文件", () => {
    const group = { exact: [null], expanded: [{ path: "new.txt" }, { path: "other.txt" }] };
    const more = [...files, { path: "other.txt", status: WorkingStatus.Untracked }];
    expect(workingMenuContext("/repo", conflicts, more, group)).toEqual({
      [MenuContextKey.Repo]: "/repo",
      [MenuContextKey.AddUntracked]: { paths: ["new.txt", "other.txt"] },
      [MenuContextKey.DeleteUntracked]: { paths: ["new.txt", "other.txt"] },
    });
  });

  it("选中 Conflicts 组、种类混着：没有批量项（全部严格）", () => {
    const group = {
      exact: [null],
      expanded: [{ path: "c.ts" }, { path: "m.ts" }, { path: "d.ts" }],
    };
    expect(workingMenuContext("/repo", conflicts, files, group)).toEqual({
      [MenuContextKey.Repo]: "/repo",
    });
  });

  it("两个两边都改的冲突：Mark as Resolved 一起做；合并编辑器只能单选", () => {
    const more = [...conflicts, { path: "n.ts", conflict: ConflictKind.BothAdded }];
    const both = [{ path: "m.ts" }, { path: "n.ts" }];
    expect(workingMenuContext("/repo", more, files, { exact: both, expanded: both })).toEqual({
      [MenuContextKey.Repo]: "/repo",
      [MenuContextKey.MarkResolved]: { paths: ["m.ts", "n.ts"] },
    });
  });

  it("空的目录、混着选：只有仓库，没有菜单项", () => {
    expect(menuOf(null)).toEqual({ [MenuContextKey.Repo]: "/repo" });
    expect(menuOf("new.txt", "a.ts")).toEqual({ [MenuContextKey.Repo]: "/repo" });
  });
});

describe("rollbackArgs：工具栏与右键的 Rollback 撤哪些", () => {
  const tracked = [
    { path: "src/a.ts", status: WorkingStatus.Modified },
    { path: "src/b.ts", status: WorkingStatus.Deleted },
  ];
  const untracked = [{ path: "new.txt", status: WorkingStatus.Untracked }];
  const files = [...tracked, ...untracked];

  it("选中目录或 Changes 组：撤它下面列出的全部", () => {
    const folder = { exact: [null], expanded: [{ path: "src/a.ts" }, { path: "src/b.ts" }] };
    expect(rollbackArgs([], files, folder)).toEqual({ paths: ["src/a.ts", "src/b.ts"] });
  });

  it("混着未跟踪文件：撤不了（全部严格）", () => {
    const both = [{ path: "src/a.ts" }, { path: "new.txt" }];
    expect(rollbackArgs([], files, { exact: both, expanded: both })).toBeUndefined();
  });

  it("什么都没选：撤全部已跟踪的改动；没有已跟踪的改动时撤不了", () => {
    const none = { exact: [], expanded: [] };
    expect(rollbackArgs([], files, none)).toEqual({ paths: ["src/a.ts", "src/b.ts"] });
    expect(rollbackArgs([], untracked, none)).toBeUndefined();
  });
});

describe("conflictHeading", () => {
  const merge = {
    kind: OperationKind.Merge,
    id: "a".repeat(40),
    subject: "feature",
    incoming: "feature",
    message: "Merge branch 'feature'",
  } as const;

  it("只有冲突：Conflicts · N，没有按钮", () => {
    expect(conflictHeading(null, 2)).toEqual({
      label: "Conflicts",
      detail: "· 2",
      keepEmpty: false,
      actions: false,
      canContinue: false,
    });
  });

  it("停着且还有冲突：不能继续", () => {
    expect(conflictHeading(merge, 1)).toEqual({
      label: "Merging feature",
      detail: "· 1 conflict",
      keepEmpty: false,
      actions: true,
      canContinue: false,
    });
  });

  it("停着且冲突已清完：标题还在，可以继续", () => {
    expect(conflictHeading(merge, 0)).toMatchObject({
      label: "Merging feature",
      detail: "",
      keepEmpty: true,
      canContinue: true,
    });
  });

  it("什么都没有：不画标题", () => {
    expect(conflictHeading(null, 0)).toBeUndefined();
  });
});

describe("opensMergeEditor", () => {
  it("两边都有内容的用合并编辑器，其余不用", () => {
    const opens = Object.values(ConflictKind).filter(opensMergeEditor);
    expect(opens).toEqual([ConflictKind.BothModified, ConflictKind.BothAdded]);
  });
});

describe("conflictFiles", () => {
  it("只取未合并条目", () => {
    expect(
      conflictFiles([
        { kind: ChangeKind.Untracked, path: "new.txt" },
        { kind: ChangeKind.Conflict, path: "c.ts", conflict: ConflictKind.BothModified },
      ]),
    ).toEqual([{ path: "c.ts", conflict: ConflictKind.BothModified }]);
  });
});

describe("workingDiffSides：左 HEAD，右工作区文件", () => {
  const H = "h".repeat(40);
  const head = (path: string) => ({ kind: DiffSideKind.Revision, hash: H, path });
  const working = (path: string) => ({ kind: DiffSideKind.WorkingTree, path });
  const missing = (path: string) => ({ kind: DiffSideKind.Missing, path });

  it.each([
    ["修改", WorkingStatus.Modified, head("a.ts"), working("a.ts")],
    ["新增", WorkingStatus.Added, missing("a.ts"), working("a.ts")],
    ["未跟踪", WorkingStatus.Untracked, missing("a.ts"), working("a.ts")],
    ["删除", WorkingStatus.Deleted, head("a.ts"), missing("a.ts")],
  ])("%s", (_name, status, left, right) => {
    expect(workingDiffSides(H, { path: "a.ts", status })).toEqual({ left, right });
  });

  it("改名：左边用 HEAD 里的旧路径", () => {
    expect(
      workingDiffSides(H, { path: "b.ts", oldPath: "a.ts", status: WorkingStatus.Renamed }).left,
    ).toEqual(head("a.ts"));
  });

  it("还没有任何提交：左边空", () => {
    expect(
      workingDiffSides(undefined, { path: "a.ts", status: WorkingStatus.Modified }).left,
    ).toEqual(missing("a.ts"));
  });
});
