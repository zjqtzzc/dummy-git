import {
  ChangeKind,
  ConflictKind,
  type FileChange,
  FileStatus,
  GitErrorCode,
  RefKind,
  UpstreamState,
} from "@dummy-git/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { cli, fixtures } from "../../../__tests__/support.js";
import { parseStatus, STATUS_ENV, statusArgs } from "../status.js";

async function statusOf(repo: string): Promise<FileChange[]> {
  const r = await cli.execRaw(statusArgs(), { cwd: repo, env: STATUS_ENV });
  return parseStatus(r.stdout);
}

describe("parseStatus：冲突", () => {
  let changes: FileChange[];
  beforeAll(async () => {
    changes = await statusOf(fixtures.conflict);
  });

  it("七种冲突码全部能解析出来", () => {
    const seen = new Set(
      changes.filter((c) => c.kind === ChangeKind.Conflict).map((c) => c.conflict),
    );
    for (const k of [
      ConflictKind.BothModified,
      ConflictKind.BothAdded,
      ConflictKind.BothDeleted,
      ConflictKind.AddedByUs,
      ConflictKind.AddedByThem,
      ConflictKind.DeletedByUs,
      ConflictKind.DeletedByThem,
    ]) {
      expect([k, seen.has(k)]).toEqual([k, true]);
    }
  });

  it("同一个路径不出现两条记录", () => {
    // vscode 的事故形态：`AA` 在 X 和 Y 两个 switch 里各命中一次。
    // 冲突单独成一支之后，这种情况在类型上就不可能。
    const paths = changes.map((c) => c.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("冲突项没有 index / worktree 两个维度", () => {
    for (const c of changes) {
      if (c.kind !== ChangeKind.Conflict) continue;
      expect(c).not.toHaveProperty("index");
      expect(c).not.toHaveProperty("worktree");
    }
  });
});

describe("parseStatus：普通改动", () => {
  let changes: FileChange[];
  beforeAll(async () => {
    changes = await statusOf(fixtures.base);
  });

  it("有已跟踪、未跟踪两类", () => {
    const kinds = new Set(changes.map((c) => c.kind));
    expect(kinds.has(ChangeKind.Tracked)).toBe(true);
    expect(kinds.has(ChangeKind.Untracked)).toBe(true);
  });

  it("未跟踪项没有 index / worktree 维度", () => {
    // 未跟踪文件在 index 里根本没有条目，
    // 「一个未跟踪文件同时有已暂存的修改」这种状态不该写得出来。
    for (const c of changes) {
      if (c.kind !== ChangeKind.Untracked) continue;
      expect(c).not.toHaveProperty("index");
    }
  });

  it("重命名带 oldPath", () => {
    const renamed = changes.find(
      (c) => c.kind === ChangeKind.Tracked && c.index === FileStatus.Renamed,
    );
    expect(renamed).toBeDefined();
    if (renamed?.kind !== ChangeKind.Tracked) throw new Error("unreachable");
    expect(renamed.oldPath).toBeDefined();
    expect(renamed.oldPath).not.toBe(renamed.path);
  });

  it("中文路径原样，不出现八进制转义", () => {
    const paths = changes.map((c) => c.path).join("|");
    expect(paths).not.toMatch(/\\[0-3][0-7][0-7]/);
  });
});

describe("statusArgs / STATUS_ENV", () => {
  it("用 porcelain v2，不是 v1", () => {
    expect(statusArgs()).toContain("--porcelain=v2");
  });

  it("带 GIT_OPTIONAL_LOCKS=0", () => {
    // 跨 M2→M3→M5 三个里程碑的欠条：进程层不认识 status，
    // 所以这个 env 必须由命令层为这条命令传入。
    expect(STATUS_ENV["GIT_OPTIONAL_LOCKS"]).toBe("0");
  });
});

describe("C.3：git 的原始格式不得渗入我们的类型", () => {
  /**
   * `enum FileStatus { Added = 'A' }` 是被禁止的——那等于把 git 的
   * porcelain 输出格式焊进类型定义。v1 与 v2 的状态字符不同，
   * 换格式时前者要改类型和所有消费方，后者只改一张映射表。
   */
  const allValues = [
    ...Object.values(ChangeKind),
    ...Object.values(ConflictKind),
    ...Object.values(FileStatus),
    ...Object.values(RefKind),
    ...Object.values(UpstreamState),
    ...Object.values(GitErrorCode),
  ];

  it("枚举值全是描述性单词，没有单字符", () => {
    for (const v of allValues) {
      expect([v, v.length > 1]).toEqual([v, true]);
    }
  });

  it("枚举值不是 git 的状态字符", () => {
    const wire = new Set(["A", "M", "D", "R", "C", "T", "U", "?", "!", " "]);
    for (const v of allValues) {
      expect([v, wire.has(v)]).toEqual([v, false]);
    }
  });
});
