import type { Commit, CommitFileChange, CommitSkeleton } from "@dummy-git/shared";
import { runRaw } from "../failure.js";
import { detailsArgs, parseLog, parseSkeleton, skeletonArgs } from "../parsers/log.js";
import { commitFilesArgs, parseNameStatus } from "../parsers/nameStatus.js";
import type { GitCommand } from "./command.js";
import { LockPolicy } from "./lock.js";

/**
 * 取提交历史。**一件事拆成两条命令**，这是 M3 定的取数模型 B
 * （「全量骨架 + 按 hash 取详情」，见 `DECISIONS.md`）。
 *
 * - `getSkeleton` 跑遍整个历史，每条只取画图必需的三个字段（hash / 父提交 / 时间）
 * - `getCommitDetails` 只对**当前屏幕要显示的那几十条**取作者、消息等
 *
 * 为什么不一次取全：实测 vscode 仓库（188,163 条提交）骨架是 18 MB，
 * 带上作者与消息是 46 MB——**画图用不到那 28 MB**。
 */

/**
 * 全量骨架。
 *
 * 纯读，`LockPolicy.None`。
 *
 * ⚠️ 它是本项目**最重的**一条只读命令：vscode 仓库上约 1.6 秒 / 18 MB。
 * 界面上必须避免频繁重跑——`NFR.md` N2「过滤输入要防抖」针对的正是这类查询。
 */
export const getSkeleton: GitCommand<[repository: string], CommitSkeleton[]> = {
  // 只读历史，不碰 index、不碰工作区。
  lock: LockPolicy.None,

  execute: async (cli, repository) => {
    // runRaw：parser 吃 Buffer 不吃字符串（`M3-parsers.md` §5）。
    // 18 MB 的输出尤其不能先解码成一整个字符串——那正是 V8 sliced string 的陷阱所在。
    const result = await runRaw(cli, skeletonArgs(), { cwd: repository });
    return parseSkeleton(result.stdout);
  },
};

/**
 * 按 hash 取详情。
 *
 * hash 列表走 **stdin**，不走命令行参数：命令行长度有上限，几百个 hash 就可能超。
 *
 * `detailsArgs()` 把 `args` 与 `input` **绑成一个返回值**，所以这里不存在
 * 「忘了传输入」——那正是 M2 §4.3 那条约束的形态（git 读到空 stdin 会返回
 * 空结果而**不报错**）。绑在一起之后，纪律由类型承担，不靠记性。
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
 * 一条提交改了哪些文件。界面上「点一条提交」那一下。
 *
 * 一次只取一条：用户一次只能点开一个。批量取没有消费者（`CLAUDE.md` D.5.1(a)），
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
