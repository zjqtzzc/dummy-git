import { classifyError, GitFailureError } from "../failure.js";
import { decode, split } from "../parsers/scan.js";
import type { GitCommand } from "./command.js";
import { LockPolicy } from "./lock.js";

/**
 * 批量问 git：这些工作区路径里，哪些是被忽略的。
 *
 * 服务 `core/ignoreCache.ts`——被 `.gitignore` 忽略的日志/构建产物持续写入时，
 * 不能让它们一路变成刷新。
 *
 * ## 为什么问 git，而不自己做模式匹配
 *
 * gitignore 的语义比看起来复杂：否定规则 `!`、父目录规则、多级 `.gitignore`、
 * `core.excludesFile`。自己实现必然某处与 git 不一致，而**危险方向的不一致**
 * （把没忽略的当成忽略了）表现为「用户的改动不显示」。
 *
 * 更关键的一点：**git 的「忽略」是认 index 的。**
 *
 * ```
 * git add -f app.log            # 既被跟踪、又匹配 .gitignore
 * git check-ignore app.log      → exit 1   不算忽略
 * git check-ignore --no-index app.log → exit 0   纯模式匹配才算
 * git status                    →  M app.log     照常报告改动
 * ```
 *
 * 纯模式匹配的库等价于 `--no-index`，会把这个文件误判成忽略、把用户的改动丢掉。
 * **我们不加防护也不会有这个洞，因为答案来自 git 自己。**
 *
 * ## 退出码是数据
 *
 * 实测（git 2.43）：
 *
 * | 情况 | exit | stdout |
 * |---|---|---|
 * | 有路径被忽略 | 0 | 被忽略的那些路径（`\0` 分隔） |
 * | **一个都没被忽略** | **1** | 空 |
 * | 真出错（不是仓库等） | 128 | — |
 *
 * `1` 是**正常答案**，不是失败。所以这条命令走 `cli.execRaw()` 自己判退出码，
 * 不走 `runRaw()`——那个「失败即抛」会把 1 当成错误。
 *
 * `run()` 刻意**没有**「某些退出码视为成功」的开关，界限就划在这里：
 * 要读退出码的命令自己读。代价是这条命令要自己负责「真出错时抛」，见下面 `default` 分支。
 */
export const checkIgnore: GitCommand<
  [repository: string, paths: readonly string[]],
  ReadonlySet<string>
> = {
  // 纯查询，不碰 index、不碰工作区。
  lock: LockPolicy.None,

  execute: async (cli, repository, paths) => {
    // 空输入时 git 同样返回 1，但没必要为此起一个子进程。
    if (paths.length === 0) return new Set();

    const args = ["check-ignore", "-z", "--stdin"];
    const result = await cli.execRaw(args, {
      cwd: repository,
      // 用 `\0` **结尾**而不是分隔：git 的 -z 输入按 NUL 终止读取，
      // 最后一条不带终止符会被丢掉。
      input: `${paths.join("\0")}\0`,
    });

    switch (result.exitCode) {
      case 0: {
        // 输出只含**被忽略的**那些路径，与输入顺序无关，所以给 Set 不给数组。
        const parts = split(result.stdout, 0x00).map((r) => decode(result.stdout, r));
        // 输出是 NUL **结尾**的，`split` 会因此多给一个末尾空段。
        // 那是格式产物不是路径——`split` 保留末尾空段是刻意的
        // （log 的 `%B` 可以为空，丢了会让字段错位），所以由调用方在这里丢。
        // git 从不输出空路径，过滤空串是安全的。
        return new Set(parts.filter((p) => p !== ""));
      }
      case 1:
        // 一个都没被忽略。正常答案。
        return new Set();
      default:
        // 真出错（不是仓库、参数写错…）。自己抛，形态与 `runRaw()` 一致，
        // 这样上层对 `GitFailureError` 的处置不必为这条命令开特例。
        throw new GitFailureError(
          args,
          result.exitCode,
          result.stderr,
          classifyError(result.stderr),
        );
    }
  },
};
