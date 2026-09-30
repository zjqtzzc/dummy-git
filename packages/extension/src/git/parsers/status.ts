/**
 * `git status` 的命令与解析。
 *
 * 用 **porcelain v2**，不用 v1（两家参考实现都用 v1，这里刻意分歧）。
 * v2 每条记录的第一个字段就是记录类型，而 `FileChange` 正是「用 `kind` 区分形态」
 * 的结构——**git 直接把 `kind` 给了我们**，不必从 `XY` 的值里猜。
 */
import {
  ChangeKind,
  ConflictKind,
  type FileChange,
  FileStatus,
  type StatusSnapshot,
} from "@dummy-git/shared";
import { GitParseError } from "./errors.js";
import { decode, type Range, split } from "./scan.js";

const NUL = 0x00;
const SPACE = 0x20;

/**
 * 记录类型，v2 每行的第一个字段。
 *
 * `!` 是被忽略的文件，只有传 `--ignored` 才会出现——我们不传，所以不处理。
 * 真出现了说明命令被改过而这里没跟上，应该报错而不是悄悄跳过。
 */
const ORDINARY = "1";
const RENAMED = "2";
const UNMERGED = "u";
const UNTRACKED = "?";
/**
 * `--branch` 带来的头部行，以 `# ` 开头。只读 `branch.oid`（HEAD 的 hash），
 * 其余（分支名、上游、领先落后）现在没人用，跳过。
 */
const HEADER = "#";
const HEAD_OID = "# branch.oid ";
/** 还没有任何提交时 `branch.oid` 的值。 */
const INITIAL = "(initial)";

/** 路径之前有多少个空格分隔的字段（含记录类型本身）。路径可能含空格，所以必须按个数切。 */
const HEAD_FIELDS = {
  [ORDINARY]: 8,
  [RENAMED]: 9,
  [UNMERGED]: 10,
  [UNTRACKED]: 1,
} as const;

/** `XY` 在 `XY` 里的位置（记录类型之后的第一个字段）。 */
const XY_FIELD = 1;

/**
 * 单个位置上的改动。**v2 用 `.` 表示「没变」**，不是 v1 的空格——
 * 少一个「前导空格容易被 trim 掉」的坑。
 *
 * 这张表放在这里而不是 `shared/`：它是 git 输出格式到我们类型的映射，
 * 属于边界，别处用不上（`CLAUDE.md §B.3`）。
 */
const STATUS_BY_CHAR: Readonly<Record<string, FileStatus>> = {
  ".": FileStatus.Unchanged,
  M: FileStatus.Modified,
  A: FileStatus.Added,
  D: FileStatus.Deleted,
  R: FileStatus.Renamed,
  C: FileStatus.Copied,
  T: FileStatus.TypeChanged,
};

/**
 * 七种冲突。`XY` 在冲突记录里**不是**「暂存区 / 工作区」两个维度，
 * 而是「我方 / 对方」的一对，只能整体查表。
 *
 * 注意这些名字的真实含义不是字面意思：`AU` 不是「我们新建了个文件」，
 * 而是「这个路径只存在于未解决冲突的我方」——一次改名冲突会同时产出
 * `DD`（原路径）+ `AU`（我方新名）+ `UA`（对方新名）三条。
 */
const CONFLICT_BY_XY: Readonly<Record<string, ConflictKind>> = {
  DD: ConflictKind.BothDeleted,
  AU: ConflictKind.AddedByUs,
  UD: ConflictKind.DeletedByThem,
  UA: ConflictKind.AddedByThem,
  DU: ConflictKind.DeletedByUs,
  AA: ConflictKind.BothAdded,
  UU: ConflictKind.BothModified,
};

export function statusArgs(): string[] {
  // -uall：未跟踪文件逐个列出，不折叠成目录（FEATURES §3.1 明确要求）。
  // --branch：顺带给出 HEAD 的 hash，与改动来自同一次调用。
  return ["status", "--porcelain=v2", "--branch", "-z", "-uall"];
}

/**
 * 这条命令必须带的环境变量。
 *
 * `git status` 会把 stat 缓存回写进 `.git/index`；扩展若监听 `.git` 感知变化，
 * 这次回写会被当成「仓库又变了」而触发刷新，刷新又跑 status——自己触发自己。
 *
 * 只给 status 加、不全局加：代价是 index 的 stat 缓存不再刷新，
 * 大仓库上连续跑只读命令会变慢，没必要让所有命令都付。
 */
export const STATUS_ENV: Readonly<Record<string, string>> = { GIT_OPTIONAL_LOCKS: "0" };

/**
 * 把一条记录按空格切成「前 n 个字段 + 剩下的整个路径」。
 *
 * 不能无脑 `split(" ")`：**路径可以含空格，且 `-z` 模式下不加引号**
 * （实测 `1 .M … tracked file.txt`）。
 */
function splitHead(buf: Buffer, record: Range, count: number): { fields: string[]; path: string } {
  const fields: string[] = [];
  let cursor = record.start;
  for (let i = 0; i < count; i++) {
    const hit = buf.indexOf(SPACE, cursor);
    if (hit === -1 || hit >= record.end) return { fields, path: "" };
    fields.push(decode(buf, { start: cursor, end: hit }));
    cursor = hit + 1;
  }
  return { fields, path: decode(buf, { start: cursor, end: record.end }) };
}

export function parseStatus(stdout: Buffer): StatusSnapshot {
  const changes: FileChange[] = [];
  let head: string | undefined;
  const records = split(stdout, NUL);

  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    if (record === undefined || record.start >= record.end) continue;

    const fail = (detail: string): GitParseError =>
      new GitParseError({
        parser: "parseStatus",
        recordIndex: index,
        detail,
        buf: stdout,
        range: record,
      });

    const kind = decode(stdout, { start: record.start, end: record.start + 1 });
    if (kind === HEADER) {
      const line = decode(stdout, record);
      if (line.startsWith(HEAD_OID)) {
        const oid = line.slice(HEAD_OID.length);
        if (oid !== INITIAL) head = oid;
      }
      continue;
    }
    if (kind !== ORDINARY && kind !== RENAMED && kind !== UNMERGED && kind !== UNTRACKED) {
      throw fail(`未知的记录类型 ${JSON.stringify(kind)}`);
    }

    const { fields, path } = splitHead(stdout, record, HEAD_FIELDS[kind]);
    if (fields.length !== HEAD_FIELDS[kind] || path === "") {
      throw fail(
        `类型 ${kind} 期望 ${HEAD_FIELDS[kind]} 个字段加路径，实际字段 ${fields.length} 个`,
      );
    }

    if (kind === UNTRACKED) {
      changes.push({ kind: ChangeKind.Untracked, path });
      continue;
    }

    const xy = fields[XY_FIELD] ?? "";

    if (kind === UNMERGED) {
      const conflict = CONFLICT_BY_XY[xy];
      // 穷举表里没有 = git 加了新码，或我们把非冲突记录错当成冲突。
      // 不设 Unknown 变体降级：那会让每个调用方永远都要处理一个多余分支，
      // 且把解析事故变成数据结构里的合法状态（见 errors.ts 的说明）。
      if (conflict === undefined) throw fail(`未知的冲突码 ${JSON.stringify(xy)}`);
      changes.push({ kind: ChangeKind.Conflict, path, conflict });
      continue;
    }

    const indexStatus = STATUS_BY_CHAR[xy[0] ?? ""];
    const worktreeStatus = STATUS_BY_CHAR[xy[1] ?? ""];
    if (indexStatus === undefined || worktreeStatus === undefined) {
      throw fail(`未知的状态码 ${JSON.stringify(xy)}`);
    }

    if (kind === RENAMED) {
      // 旧路径在**下一个 NUL 段**里，不在同一段。顺序是新路径在前、旧路径在后——
      // 与不带 -z 的 `old -> new` 正好相反，照着那个写会把新旧颠倒，
      // 而且颠倒后两个路径都合法、不报错，只是显示反了。
      const next = records[++index];
      if (next === undefined) throw fail("重命名记录缺少旧路径");
      changes.push({
        kind: ChangeKind.Tracked,
        path,
        oldPath: decode(stdout, next),
        index: indexStatus,
        worktree: worktreeStatus,
      });
      continue;
    }

    changes.push({
      kind: ChangeKind.Tracked,
      path,
      index: indexStatus,
      worktree: worktreeStatus,
    });
  }

  return head === undefined ? { changes } : { head, changes };
}
