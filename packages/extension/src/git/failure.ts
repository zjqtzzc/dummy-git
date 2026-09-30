/**
 * git 命令失败的分类。
 *
 * 文件名是 `failure.ts` 而不是 `errors.ts`：`parsers/errors.ts` 已经占用了那个名字，
 * 且两者管的是不同的东西——那个是**解析失败**的诊断，这个是**命令失败**的分类。
 *
 * ## ⚠️ 这里的正则依赖进程层强制的 `LC_ALL=en_US.UTF-8`
 *
 * git 的错误消息是会本地化的。中文环境下 `not a git repository` 会变成中文，
 * 两条正则同时失效——而且**不报错，只是永远返回 `undefined`**。
 * 表现是「锁冲突的提示突然变回裸 stderr」，几乎没人会联想到 locale。
 *
 * 所以 `cli.ts` 的 `FORCED_ENV` 里那三行 `LANGUAGE`/`LC_ALL`/`LANG` 不是可选项。
 *
 * ## 为什么不看退出码
 *
 * 实测：锁冲突、非仓库、引用不存在、参数写错、远程不存在——**退出码全是 128**。
 * 128 是 git 调 `die()` 的统一出口，表示「发生了致命错误」，是哪个错误一概不说。
 *
 * 退出码分类是真的，但**必须知道当时在跑什么命令**：`merge` 的 `exit 1` 是「有冲突」，
 * `diff --quiet` 的 `exit 1` 是「有差异」，`checkout` 的 `exit 1` 才是「失败了」。
 * 那属于命令层（`commands/`）。
 */
import { GitErrorCode } from "@dummy-git/shared";
import type { ExecOptions, GitCli } from "./cli.js";
import type { ExecResult, RawExecResult } from "./types.js";

/**
 * 认得出的失败，各配一条正则。认不出返回 `undefined`——那是常态，不是故障。
 *
 * 顺序无关：两条正则不可能同时命中。
 */
const PATTERNS: readonly (readonly [RegExp, GitErrorCode])[] = [
  /**
   * 实测输出：`fatal: not a git repository (or any of the parent directories): .git`
   *
   * 大小写不敏感是必须的——老版本 git 输出的是首字母大写的 `Not a git repository`。
   */
  [/not a git repository/i, GitErrorCode.NotAGitRepository],

  /**
   * 实测输出（git 2.43）：
   *
   * ```
   * fatal: Unable to create '.../.git/index.lock': File exists.
   *
   * Another git process seems to be running in this repository, e.g.
   * an editor opened by 'git commit'. ...
   * ```
   *
   * **刻意不匹配第一行的 `Unable to create ... File exists.`**——那句太泛，
   * `git worktree add` 撞到同名目录时会出现近似措辞，匹配它会误报。
   * 认准第二段那句独特的话。
   *
   * 第二个分支 `If no other git process is currently running` 在 git 2.43 上不出现
   * （2.43 说的是 `If it still fails`），它是给别的 git 版本留的。
   * 多一个分支的代价是零，漏掉一个版本的代价是分类静默失效。
   *
   * **这条同时覆盖 ref 锁**（`.git/refs/heads/xxx.lock`），实测确认 git 会给它
   * 追加完全相同的解释段落：
   *
   * ```
   * fatal: cannot lock ref 'HEAD': Unable to create '.../main.lock': File exists.
   *
   * Another git process seems to be running in this repository, e.g. ...
   * ```
   *
   * 覆盖它是**对的**：同样的成因（另一个 git 进程）、同样的处置（等）、
   * 同样该显示的消息。只有要对 ref 锁单独重试时才需要把它分出来——我们不重试。
   */
  [
    /Another git process seems to be running in this repository|If no other git process is currently running/,
    GitErrorCode.RepositoryIsLocked,
  ],
];

/**
 * 从 stderr 认出失败类型。
 *
 * **只收 stderr，不收退出码。** 调用方（`run()`）已经判定了「这次失败了」，
 * 这里只回答「是哪一类」。在函数内再判一次 `exitCode === 0` 属于防御性检查，
 * 违反 `CLAUDE.md §C.2`——「`exitCode === 0` 永不产出失败」由**唯一调用点**保证，
 * 不由运行时检查保证。
 */
export function classifyError(stderr: string): GitErrorCode | undefined {
  for (const [pattern, code] of PATTERNS) {
    if (pattern.test(stderr)) return code;
  }
  return undefined;
}

/**
 * 一条 git 命令失败了。`run()` 在非零退出码时抛出。
 *
 * 字段分两类用途，**不要混用**：
 * - `code` 用于**决策**（`Repository` 见 `NotAGitRepository` 就置 Disposed）。可缺席——
 *   认不出是常态（见文件头），缺席时下游只能走通用处置。
 * - `exitCode` / `stderr` / `args` 用于**排查**：写日志、给用户看原文。
 *   拿 `stderr` 做 `includes` 判断正是本文件要消灭的东西。
 */
export class GitFailureError extends Error {
  constructor(
    readonly args: readonly string[],
    readonly exitCode: number,
    readonly stderr: string,
    /** 认不出时缺席。不设 `Unknown` 成员，理由见文件头。 */
    readonly code?: GitErrorCode,
  ) {
    // 消息取 stderr 第一行：完整 stderr 放在字段里，堆栈里挤一大段没用。
    // 注意第一行未必是最有用的那句——`RepositoryIsLocked` 就是反例，
    // 所以给用户看的文案该由 `code` 决定，不该直接用这里的 message。
    super(`git ${args.join(" ")} 失败（exit ${exitCode}）：${stderr.split("\n")[0] ?? ""}`);
    this.name = "GitFailureError";
  }
}

/**
 * 命令层的默认入口：跑一条 git 命令，**失败就抛**。
 *
 * 与 `cli.exec()` 的分工是刻意的：
 *
 * - `run()` —— 绝大多数命令。非零退出码 = 出事了，抛。
 * - `cli.exec()` —— **明确要读退出码**的少数命令。`git diff --quiet` 的 `1` 是
 *   「有差异」、`git merge` 的 `1` 是「有冲突」、`rev-parse --verify` 的 `128` 是
 *   「引用不存在」——这些都是合法答案，不是失败。
 *
 * **`run()` 不提供「某些退出码视为成功」的开关。** 需要读退出码就改用 `exec()`，
 * 界限清楚。「默认仍抛、只开个逃生口」的开关容易让调用方写出永不可达的分支。
 *
 * 「`exitCode === 0` 永不产出失败」的保证点已收口到 `throwIfFailed()`，
 * `run()` 与 `runRaw()` 共用。
 */
export async function run(
  cli: GitCli,
  args: readonly string[],
  options: ExecOptions,
): Promise<ExecResult> {
  const result = await cli.exec(args, options);
  throwIfFailed(args, result.exitCode, result.stderr);
  return result;
}

/**
 * `run()` 的字节版：stdout 保持 `Buffer`，不解码。
 *
 * **parser 全部吃 `Buffer`**（`parseStatus(stdout: Buffer)`）：在字节层切分才不会拖住大缓冲区、
 * 也不会切坏多字节字符。所以凡是「跑完要解析」的命令都走这里，不走 `run()`。
 *
 * 读某个版本的文件原始字节（`getFileContent`）也用它。
 */
export async function runRaw(
  cli: GitCli,
  args: readonly string[],
  options: ExecOptions,
): Promise<RawExecResult> {
  const result = await cli.execRaw(args, options);
  throwIfFailed(args, result.exitCode, result.stderr);
  return result;
}

/**
 * 「`exitCode === 0` 永不产出失败」的**唯一保证点**。
 *
 * `run()` 与 `runRaw()` 都收口到这里，不各写一份——否则改分类逻辑时会漏掉一个。
 * `classifyError` 本身不看退出码（见文件头），全靠这一处收口。
 */
function throwIfFailed(args: readonly string[], exitCode: number, stderr: string): void {
  if (exitCode !== 0) {
    throw new GitFailureError(args, exitCode, stderr, classifyError(stderr));
  }
}
