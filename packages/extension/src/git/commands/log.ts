import type { Commit, CommitFileChange, CommitSkeleton, MatchCondition } from "@dummy-git/shared";
import { runRaw } from "../failure.js";
import {
  type AuthorCount,
  authorsArgs,
  detailsArgs,
  matchArgs,
  parseAuthors,
  parseHashes,
  parseLog,
  parseSkeleton,
  skeletonArgs,
} from "../parsers/log.js";
import { commitFilesArgs, parseNameStatus } from "../parsers/nameStatus.js";
import type { GitCommand } from "./command.js";
import { LockPolicy } from "./lock.js";

/**
 * 取提交历史。**一件事拆成两条命令**：全量骨架 + 按 hash 取详情。
 *
 * - `getSkeleton` 跑遍整个历史，每条只取画图必需的三个字段（hash / 父提交 / 时间）
 * - `getCommitDetails` 只对**当前屏幕要显示的那几十条**取作者、消息等
 *
 * 为什么不一次取全：实测 vscode 仓库（188,163 条提交）骨架是 18 MB，
 * 带上作者与消息是 46 MB——**画图用不到那 28 MB**。
 */

/**
 * 骨架：最近的 `SKELETON_LIMIT` 条，更早的不取。
 *
 * 上限是需求（第 1 阶段「提交列表最多一万条」），理由见 `ARCHITECTURE.md` 第 8 题：
 * 不设上限时 18.8 万条的仓库常驻约 360 MB，更大的仓库会让扩展宿主内存溢出。
 *
 * 纯读，`LockPolicy.None`。
 *
 * ⚠️ 它是本项目**最重的**一条只读命令：vscode 仓库上约 1.6 秒 / 18 MB。
 * 界面上必须避免频繁重跑——`NFR.md` N2「过滤输入要防抖」针对的正是这类查询。
 */
export const SKELETON_LIMIT = 10_000;

export const getSkeleton: GitCommand<[repository: string], CommitSkeleton[]> = {
  // 只读历史，不碰 index、不碰工作区。
  lock: LockPolicy.None,

  execute: async (cli, repository) => {
    // runRaw：parser 吃 Buffer 不吃字符串。
    // 18 MB 的输出尤其不能先解码成一整个字符串——那正是 V8 sliced string 的陷阱所在。
    const result = await runRaw(cli, skeletonArgs(SKELETON_LIMIT), { cwd: repository });
    return parseSkeleton(result.stdout);
  },
};

/**
 * 按 hash 取详情。
 *
 * hash 列表走 **stdin**，不走命令行参数：命令行长度有上限，几百个 hash 就可能超。
 *
 * `detailsArgs()` 把 `args` 与 `input` **绑成一个返回值**，所以这里不存在
 * 「忘了传输入」（git 读到空 stdin 会返回空结果而**不报错**）。
 * 绑在一起之后，纪律由类型承担，不靠记性。
 */
export const getCommitDetails: GitCommand<
  [repository: string, hashes: readonly string[]],
  Commit[]
> = {
  lock: LockPolicy.None,

  execute: async (cli, repository, hashes) => {
    const { args, input } = detailsArgs(hashes);
    const result = await runRaw(cli, args, { cwd: repository, input });
    return parseLog(result.stdout);
  },
};

/**
 * 在给定的提交里，哪些满足条件（说明含有某段字、作者是某人）。只返回命中的 hash，顺序不保证。
 * 没有命中时 git 也要把给的提交全看一遍：只给骨架那一万条，耗时就有上限（`NFR.md` 第 3 节）。
 */
export const matchCommits: GitCommand<
  [repository: string, hashes: readonly string[], condition: MatchCondition],
  string[]
> = {
  lock: LockPolicy.None,

  execute: async (cli, repository, hashes, condition) => {
    const { args, input } = matchArgs(hashes, condition);
    const result = await runRaw(cli, args, { cwd: repository, input });
    return parseHashes(result.stdout);
  },
};

/** 给定提交里的作者，每人几条，按条数从多到少。User 按钮的列表。 */
export const listAuthors: GitCommand<
  [repository: string, hashes: readonly string[]],
  AuthorCount[]
> = {
  lock: LockPolicy.None,

  execute: async (cli, repository, hashes) => {
    const { args, input } = authorsArgs(hashes);
    const result = await runRaw(cli, args, { cwd: repository, input });
    return parseAuthors(result.stdout);
  },
};

/**
 * 一条提交改了哪些文件。界面上「点一条提交」那一下。
 *
 * 一次只取一条：用户一次只能点开一个。批量取没有消费者（`CLAUDE.md` D.6(a)），
 * 真需要时加一条命令，不要现在把参数改成数组。
 *
 * 返回 `CommitFileChange` 而不是 `FileChange`：后者带 `index`/`worktree`
 * 两个维度（暂存区、工作区），而一条**已经存在的**提交没有这两个维度，
 * 复用就得给那两个字段编造值（见 `shared/change.ts`）。
 */
export const getCommitFiles: GitCommand<[repository: string, hash: string], CommitFileChange[]> = {
  // 只读一条提交的 diff，不碰 index、不碰工作区。
  lock: LockPolicy.None,

  execute: async (cli, repository, hash) => {
    const result = await runRaw(cli, commitFilesArgs(hash), { cwd: repository });
    return parseNameStatus(result.stdout, hash);
  },
};
