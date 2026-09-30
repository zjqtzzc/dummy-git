import { ChangeKind, ConflictKind, type FileChange, FileStatus } from "@dummy-git/shared";
import { describe, expect, it } from "vitest";
import { WorkingStatus, workingFiles, workingGroups } from "../workingChanges.js";

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
  it("已跟踪进 Changes，未跟踪进 Unversioned Files", () => {
    const groups = workingGroups([
      { path: "a.ts", status: WorkingStatus.Modified },
      { path: "new.txt", status: WorkingStatus.Untracked },
    ]);
    expect(groups.map((g) => [g.label, g.entries.map((e) => `${e.letter} ${e.path}`)])).toEqual([
      ["Changes", ["M a.ts"]],
      ["Unversioned Files", ["U new.txt"]],
    ]);
  });
});
