import type { RepositoryLocation } from "../git/commands/index.js";

/**
 * `.git` 目录的订阅白名单。
 *
 * ## 这是订阅层的东西，不是过滤逻辑
 *
 * `classify.ts` 的噪声规则**仍然保留**，两者不是二选一：
 *
 * - **白名单**（本文件）决定「哪些事件会到达」——`objects/**` 的事件
 *   根本不会被送过来。一次 `fetch` 能刷出上千个 object 事件，
 *   全订阅再过滤是收下来再丢掉，白名单是压根不收。
 * - **噪声规则**（`classify.ts`）是兜底。glob 表达不了 `*.lock` 这类
 *   跨目录的后缀规则，而且不同平台的 watcher 后端行为有差异
 *   （有的会把子目录的批量删除合并成父目录的一个事件）。
 *
 * 少了任何一个都不行：只有白名单，`index.lock` 会漏进来（它匹配 `index*`
 * 这类模式）；只有噪声规则，`fetch` 时要在 JS 里过滤上千个事件。
 *
 * ## 为什么不直接写成一个 `**`
 *
 * 那就是「全订阅再过滤」，正是这一步要改掉的。
 *
 * ## 消费者
 *
 * `vscode/watcher.ts`：按 `watchTargets()` 的结果逐个 `createFileSystemWatcher`。
 * 本文件只给字符串，不碰 VSCode API——这一层要能在纯 node 下跑。
 */

/**
 * 与 worktree 绑定的文件（每个 linked worktree 有自己的一份）。
 *
 * - `index` —— 暂存区
 * - `HEAD` / `*_HEAD` —— HEAD 与 `ORIG_HEAD`/`FETCH_HEAD`/`MERGE_HEAD`/
 *   `CHERRY_PICK_HEAD`/`REVERT_HEAD`/`REBASE_HEAD`，一条模式全覆盖
 * - `MERGE_*` —— `MERGE_MSG` 等（`MERGE_HEAD` 已被 `*_HEAD` 覆盖）
 * - `rebase-merge/**` `rebase-apply/**` —— rebase 进行中的状态
 * - `sequencer/**` —— **多提交 cherry-pick / revert 的序列进度**。
 *   漏了它是功能漏判（界面看不出「还剩几个」），不是性能问题。
 */
const WORKTREE_FILES = [
  "index",
  "HEAD",
  "*_HEAD",
  "MERGE_*",
  "rebase-merge",
  "rebase-merge/**",
  "rebase-apply",
  "rebase-apply/**",
  "sequencer",
  "sequencer/**",
] as const;

/**
 * 整个仓库共享的文件（linked worktree 与主仓库共用同一份）。
 *
 * - `config` —— remote 增删、upstream 跟踪关系
 * - `refs/**` `packed-refs` —— 分支与 tag。`packed-refs` 最容易漏：
 *   `git gc` 之后 ref 就从 `refs/*` 搬进它，此后更新**只写它**
 * - `logs/**` —— reflog，`refs/stash` 的变化也反映在这里
 * - `shallow` —— 浅克隆截断点。ref 指向可以没动，而祖先关系变了
 * - `info/exclude` —— 忽略规则的来源之一，变了要让 `ignoreCache` 失效
 */
const COMMON_FILES = [
  "config",
  "packed-refs",
  "shallow",
  "info/exclude",
  "refs/**",
  "logs/**",
] as const;

/**
 * 标准仓库（没有 linked worktree）：一个 watcher 覆盖全部。
 *
 * VSCode 的 glob 支持 `{a,b,c}` 分组。
 */
export const DOT_GIT_GLOB = `{${[...WORKTREE_FILES, ...COMMON_FILES].join(",")}}`;

/** 有 linked worktree 时：主 watcher 只看 worktree 专属文件。 */
export const DOT_GIT_GLOB_WORKTREE = `{${WORKTREE_FILES.join(",")}}`;

/** 有 linked worktree 时：共用 watcher 看共享文件。 */
export const DOT_GIT_GLOB_COMMON = `{${COMMON_FILES.join(",")}}`;

/** 一个要监听的目录，以及在它下面订阅哪些路径。 */
export interface WatchTarget {
  readonly directory: string;
  readonly glob: string;
}

/**
 * 仓库的 git 目录要监听哪几处。
 *
 * - 普通仓库：`gitDir` 与 `commonDir` 是同一个目录，一个 watcher 用完整白名单。
 * - linked worktree：专属文件在 `<主仓库>/.git/worktrees/<名字>`，共享文件在主仓库的 `.git`，
 *   两处各一个 watcher、各用各的白名单。写死 `<根>/.git` 在这里什么都监听不到——
 *   那里是个文本文件。
 *
 * 两处的相对路径都与普通 `.git` 同形（`HEAD`、`refs/heads/main`），`classify.ts` 不用区分来源。
 */
export function watchTargets(location: RepositoryLocation): readonly WatchTarget[] {
  if (location.gitDir === location.commonDir) {
    return [{ directory: location.gitDir, glob: DOT_GIT_GLOB }];
  }
  return [
    { directory: location.gitDir, glob: DOT_GIT_GLOB_WORKTREE },
    { directory: location.commonDir, glob: DOT_GIT_GLOB_COMMON },
  ];
}
