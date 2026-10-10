import {
  ChangeKind,
  ConflictKind,
  DiffSideKind,
  type FileChange,
  FileStatus,
} from "@dummy-git/shared";
import { describe, expect, it } from "vitest";
import {
  conflictFiles,
  WorkingStatus,
  workingDiffSides,
  workingFiles,
  workingGroups,
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

  it("未跟踪照列；冲突第 7 阶段才显示，先跳过", () => {
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
