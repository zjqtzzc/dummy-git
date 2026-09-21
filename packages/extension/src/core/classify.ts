import { GitDomain } from "@dummy-git/shared";

/**
 * 把 `.git` 目录内的一次文件变化，翻译成「哪几类数据过期了」。
 *
 * ## 本文件只做分类，不做编排
 *
 * 订阅、防抖、生命周期在 `watcher.ts`；工作区路径的 ignore 过滤在 `ignoreCache.ts`。
 * 拆开是为了让这一层**保持纯粹**——它是唯一能拿一串真实路径直接跑给人看的东西
 * （见 M6 第 3 步：用实测抓到的 27 条 commit 事件路径验证）。
 * 混进状态之后那种验证就做不了了。
 *
 * ## 这一层为什么是纯函数
 *
 * 它只认字符串，不认识 VSCode、不认识文件系统、不订阅任何东西。
 * 好处是能在普通 node 里直接跑给人看——本项目不写测试，
 * `scripts/demo-*.mjs` 是唯一的可观察物，一旦这层 import 了 `vscode` 就再也跑不了。
 *
 * 真正去订阅文件事件的那部分属于 `vscode/` 层（M7），它把事件喂给这里。
 *
 * ## 输入的约定
 *
 * `relPath` 是**相对 `.git` 目录**、**以 `/` 分隔**的路径。
 *
 * 分隔符这条不是小事：Windows 上 `uri.fsPath` 给的是反斜杠，
 * 直接传进来所有前缀判断都会失效，而且**不报错**——只是所有事件都被当成认不出的丢掉，
 * 表现为「Windows 上界面永远不刷新」。归一化是调用方的责任（`CLAUDE.md` §C.1：
 * 校验只在边界做一次，这里是边界之内）。
 *
 * ## 返回空数组 = 这个事件该丢弃
 *
 * 不是「出错了」，是「这个变化跟我们关心的状态无关」。
 */

/**
 * 预先定好的几种组合。
 *
 * 不在函数里现拼数组，是因为这个函数**每个文件事件调用一次**——
 * 一次 `fetch` 能刷出成千上万个事件（虽然大部分会被噪声规则挡掉）。
 * 写成常量之后，这几行读起来也更像一张表。
 */
const NONE: readonly GitDomain[] = Object.freeze([]);
const REFS: readonly GitDomain[] = Object.freeze([GitDomain.Refs]);
const WORKTREE: readonly GitDomain[] = Object.freeze([GitDomain.Worktree]);
const REFS_WORKTREE: readonly GitDomain[] = Object.freeze([GitDomain.Refs, GitDomain.Worktree]);
const STASH_WORKTREE: readonly GitDomain[] = Object.freeze([GitDomain.Stash, GitDomain.Worktree]);
const OP_WORKTREE: readonly GitDomain[] = Object.freeze([GitDomain.Operation, GitDomain.Worktree]);
const OP_REFS_WORKTREE: readonly GitDomain[] = Object.freeze([
  GitDomain.Operation,
  GitDomain.Refs,
  GitDomain.Worktree,
]);

/**
 * 先挡噪声。
 *
 * 顺序不能反：噪声的量级远大于有效事件。实测一次 `commit` 产生 27 个事件，
 * **17 个是噪声**（`.notes/NFR.md` §7）。
 *
 * - `objects/` —— `fetch` 时能刷出成千上万个。注意这个 watcher 是绕开
 *   `files.watcherExclude` 建的，默认那条 `**​/.git/objects/**` 排除保护不到它。
 * - `*.lock` —— 每次 git 操作都建了又删。实测除了 `index.lock` / `HEAD.lock`，
 *   还有 `next-index-<pid>.lock` 这种带随机数字的，**靠后缀一条规则全覆盖**，
 *   不必逐个列举。
 *   （另见 `design/locking.md` §5：不把 `.git/index.lock` 当状态源。）
 * - `hooks/` `info/` `lfs/` —— 与我们关心的状态无关。
 */
function isNoise(relPath: string): boolean {
  return (
    relPath.startsWith("objects/") ||
    relPath.startsWith("lfs/") ||
    relPath.startsWith("hooks/") ||
    relPath.startsWith("info/") ||
    relPath.endsWith(".lock") ||
    // git 自己的文件监控守护进程的产物（socket、cookie 文件）。
    // `.lock` 规则挡不住它们。来源：GitLens `watcherPatterns.ts`。
    relPath.startsWith("fsmonitor--daemon/") ||
    // 交互式 rebase 的待办清单。它是**用户在编辑器里改的文件**——
    // 每存一次盘就是一个事件，而 rebase 的真实进展由 `rebase-merge/` 下的
    // 兄弟文件反映，这个文件本身不带状态信息。
    // 不挡的话，用户编辑 todo 的整个过程都在刷界面。来源：GitLens `classifyChange.ts`。
    relPath.endsWith("/git-rebase-todo") ||
    relPath.endsWith("/git-rebase-todo.backup")
  );
}

/**
 * `.git` 内的相对路径 → 受影响的域。
 *
 * 判断顺序有讲究，见各条上的说明。
 */
export function classifyGitPath(relPath: string): readonly GitDomain[] {
  if (isNoise(relPath)) {
    return NONE;
  }

  // stash 及其 reflog。**必须排在下面的 `refs/` 与 `logs/` 前缀判断之前**，
  // 否则会被它们抢走、错判成 Refs（那是 1.9 秒的重拉，而 stash 只要几毫秒）。
  if (relPath === "refs/stash" || relPath === "logs/refs/stash") {
    return STASH_WORKTREE;
  }

  // 进行中的操作。这些文件在则「卡在半途」，不在则结束了。
  if (
    relPath === "MERGE_HEAD" ||
    relPath === "MERGE_MSG" ||
    relPath === "CHERRY_PICK_HEAD" ||
    relPath === "REVERT_HEAD"
  ) {
    return OP_WORKTREE;
  }

  // rebase 三个域都动：它一边搬 ref、一边改工作区、还可能停在冲突里。
  //
  // `sequencer/` 同理，而且**漏了它是功能漏判，不是性能问题**：
  // 多提交的 `cherry-pick` / `revert` 用 `.git/sequencer/` 记录序列进度
  // （`todo` 文件列出剩余的提交）。不认它的话，序列进行中的状态根本不显示——
  // 界面上看不出「正在 cherry-pick，还剩 3 个」。来源：GitLens `watcherPatterns.ts`。
  if (
    relPath === "REBASE_HEAD" ||
    relPath.startsWith("rebase-merge/") ||
    relPath.startsWith("rebase-apply/") ||
    relPath.startsWith("sequencer/")
  ) {
    return OP_REFS_WORKTREE;
  }

  // 暂存区。**只给 Worktree，绝不给 Refs**——`git status` 自己会回写 index 刷新
  // stat 缓存，算进 Refs 就会变成 status → 写 index → 重拉 → 又跑 status 的回路。
  // 见 `domains.ts` 上 `Worktree` 的说明。
  if (relPath === "index") {
    return WORKTREE;
  }

  // 切分支同时改 ref 和工作区文件；COMMIT_EDITMSG 意味着刚产生了一个提交
  // （含外部终端里的提交——那正是 watcher 存在的理由）。
  if (relPath === "HEAD" || relPath === "COMMIT_EDITMSG") {
    return REFS_WORKTREE;
  }

  if (
    // packed-refs 最容易漏：`git gc` / `git pack-refs` 之后 ref 就从 refs/* 搬进
    // 这个文件了，此后对已打包 ref 的更新**只写它**。漏了的表现是
    // 「某些分支的更新看不见」，且很难查。
    relPath === "packed-refs" ||
    relPath === "FETCH_HEAD" ||
    relPath === "ORIG_HEAD" ||
    // remote 增删、upstream 跟踪关系的变化都写在 config 里
    relPath === "config" ||
    // 这两个改的是**祖先关系**，不是 ref 指向：
    // `shallow` 记录浅克隆的截断点，`refs/replace/**` 让 git 在遍历时
    // 用另一个对象替换掉某个提交。即使所有分支的指向都没动，
    // 提交图的形状也变了。GitLens 把它们归到 `heads`，同一判断。
    // （`refs/replace/` 本来就被下面的 `refs/` 前缀覆盖，这里只是显式记一笔。）
    relPath === "shallow" ||
    relPath.startsWith("refs/") ||
    relPath.startsWith("logs/")
  ) {
    return REFS;
  }

  // worktree / submodule
  if (relPath.startsWith("worktrees/") || relPath.startsWith("modules/")) {
    return REFS_WORKTREE;
  }

  // 认不出的路径**丢弃，不兜底刷新**。
  //
  // 会改变状态的动作必然同时碰到上面某条已覆盖的路径（HEAD、index、refs/**、
  // logs/**、MERGE_HEAD…）。真发现漏判，应该在上面加一条明确规则，
  // 而不是在这里默默刷新——兜底会让「为什么刷了」永远查不清。
  //
  // IntelliJ 的 `GitRepositoryUpdater.filesChanged()` 也是白名单、认不出就落空，
  // 是独立实现的同一判断。
  return NONE;
}
