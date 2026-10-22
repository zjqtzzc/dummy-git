/**
 * **所有 git 命令的唯一出口。** `git/` 以外只许从这里 import 命令（lint 强制，见 `biome.json`）。
 *
 * 想知道「我们到底对 git 跑了什么」，读这一张表就够，不必翻十几个文件。
 * 命令行本身留在各自的文件里：`--format=` 的字段顺序必须与解析代码紧挨着，
 * 所以 `log` / `status` 这类的参数在 `parsers/`，其余在 `commands/`。
 *
 * ## 最低支持 git 2.25（Ubuntu 20.04）
 *
 * 下表「要求」一列的最高值是 2.23，不能超过 2.25。**新加一条命令就在表里加一行；某行要求超过 2.25 时，
 * 先定要不要放宽最低版本。** 不做运行时版本检测（理由同上）。
 * 老版本上「不报错、只是结果不一样」的差异只有真跑才测得出：`pnpm test:old-git` 在 2.25 上跑一遍测试。
 *
 * 所有命令还共用进程层强制注入的环境变量（`cli.ts` 的 `FORCED_ENV`），不涉及版本。
 *
 * | 命令 | 执行的 git | 较新的特性 | 要求 |
 * |---|---|---|---|
 * | `getGitVersion` | `--version` | — | — |
 * | `getRepositoryLocation` | `rev-parse --show-toplevel --absolute-git-dir --git-common-dir` | `--absolute-git-dir` | 2.13 |
 * | `getStatus` | `status --porcelain=v2 --branch -z -uall`，环境 `GIT_OPTIONAL_LOCKS=0` | `--porcelain=v2`；`GIT_OPTIONAL_LOCKS` | 2.11；2.15 |
 * | `checkIgnore` | `check-ignore -z --stdin --verbose` | — | — |
 * | `commit` | `add -- <未跟踪…>`（有才跑）+ `commit --only -F - -- <路径…>` | — | — |
 * | `amendCommit` | 同上，`commit --amend --only …`；路径可为空（只改说明） | — | — |
 * | `fetchAll` | `fetch --all --prune` | — | — |
 * | `listRemotes` | `remote` | — | — |
 * | `addRemote` | `remote add -- <名字> <地址>` | — | — |
 * | `push` | `push [-u] [--force-with-lease] <远程> refs/heads/<B>:refs/heads/<M>` | — | — |
 * | `fetchInto` | `fetch <远程> refs/heads/<M>:refs/heads/<B>`（更新非当前分支） | — | — |
 * | `fetchBranch` | `fetch <远程> refs/heads/<M>`（更新当前分支第一步） | — | — |
 * | `fastForward` | `merge --ff-only <远程分支记录>`（更新当前分支第二步） | — | — |
 * | `switchBranch` | `switch <分支>` | `git switch` | 2.23 |
 * | `createTrackingBranch` | `switch -c <分支> --track <远程分支>` | `git switch` | 2.23 |
 * | `createBranch` | `switch -c <分支> --no-track <起点>` | `git switch` | 2.23 |
 * | `renameBranch` | `branch -m <旧名> <新名>` | — | — |
 * | `deleteBranch` | `branch -d <分支>` | — | — |
 * | `forceDeleteBranch` | `branch -D <分支>` | — | — |
 * | `deleteRemoteBranches` | `push <远程> --delete refs/heads/<分支>…` | — | — |
 * | `isValidBranchName` | `check-ref-format --branch <名字>` | — | — |
 * | `getStashes` | `stash list -z --format=…` | — | — |
 * | `stashAll` | `stash push -u` | — | — |
 * | `stashPaths` | `write-tree` + `diff --cached --name-only --no-renames -z` + `restore --staged -- <没勾的>` + `stash push -u -- <路径…>` + `restore --source=<树> --staged -- <没勾的>` | `git restore` | 2.23 |
 * | `applyStash` | `stash apply <hash>` | — | — |
 * | `popStash` | `stash list …` 找序号 + `stash pop stash@{n}` | — | — |
 * | `dropStash` | `stash list …` 找序号 + `stash drop stash@{n}` | — | — |
 * | `unstage` | `restore --staged -- <路径…>` | `git restore` | 2.23 |
 * | `addPaths` | `add -- :(literal)<路径>…` | — | — |
 * | `removeConflictPaths` | `rm -q -- :(literal)<路径>…` | — | — |
 * | `continueInProgress` | `merge` / `rebase` / `cherry-pick` / `revert --continue`，环境 `GIT_EDITOR=true` | — | — |
 * | `abortInProgress` | 同上四种的 `--abort` | — | — |
 * | `mergeRef` | `merge -m <说明> <引用>` | — | — |
 * | `rebaseOnto` | `rebase --autostash <引用> [<分支>]` | `--autostash` | 2.6 |
 * | `replayCommits` | `cherry-pick` / `revert --no-edit --stdin`，变空时 `--skip` | `--skip` | **2.23** |
 * | `resetTo` | `reset -q --soft/--mixed/--keep/--hard <hash>` | — | — |
 * | `rewordCommit` | `rev-list --first-parent --parents HEAD --not <hash>^@` + `config --bool --get commit.gpgSign` + `stripspace` + 逐条 `cat-file commit` 与 `commit-tree [-S] <tree> -p <父>` + `update-ref -m reword HEAD <新> <旧>` | — | — |
 * | `rollback` | `restore --source=HEAD --staged --worktree -- <路径…>` | `git restore` | **2.23** |
 * | `getSkeleton` | `-c log.showSignature=false log --format=… --max-count=10000 HEAD --branches --remotes --tags --date-order --`；按分支过滤时起点换成那个分支；拓扑排序时 `--topo-order` | — | — |
 * | `getHeadBases` | `merge-base --all HEAD <起点>`（不按分支过滤时起点是 HEAD） | — | — |
 * | `getCommitDetails` | `-c log.showSignature=false log --format=… --no-walk --stdin` | — | — |
 * | `getOutgoingCommits` | `-c log.showSignature=false log --format=… --max-count=<N> refs/heads/<B> --not refs/remotes/<R>/<M>`（远程上还没有时 `--remotes=<R>`）`--` | — | — |
 * | `getRefs` | `for-each-ref --format=… refs/heads refs/remotes refs/tags` | `%(upstream:remotename)` / `%(upstream:remoteref)`（git 2.16.0 发布说明） | 2.16 |
 * | `getHead` | `rev-parse HEAD --symbolic-full-name HEAD` | — | — |
 * | `getFileContent` | `cat-file --filters <提交>:<路径>` | `--filters` | 2.11 |
 * | `getStageContent` | `cat-file --filters :<1/2/3>:<路径>` | `--filters` | 2.11 |
 * | `getConflictStages` | `ls-files -u -z -- :(literal)<路径>` | — | — |
 * | `matchCommits` | `-c log.mailmap=true -c log.showSignature=false log --format=%H --no-walk --stdin -F` + `-i --grep=<文字>` / `--author=<名字 <邮箱>>` / `-- :(literal)<路径>` | — | — |
 * | `listAuthors` | `-c log.showSignature=false log --format=%aN%x00%aE --no-walk --stdin` | — | — |
 * | `listPaths` | `ls-files -z` | — | — |
 * | `getIdentity` | `config --get user.name` + `config --get user.email`，再 `check-mailmap <名字 <邮箱>>` | — | — |
 * | `getCommitFiles` | `-c log.showSignature=false log -1 -M -m --first-parent --format= --name-status -z <hash>` | — | — |
 *
 * `-c log.showSignature=false` 在不认识这个配置的旧 git 上是无害的空设置，不构成版本要求。
 */

export {
  createBranch,
  createTrackingBranch,
  DeleteBranchKind,
  type DeleteBranchResult,
  deleteBranch,
  deleteRemoteBranches,
  forceDeleteBranch,
  isValidBranchName,
  renameBranch,
  switchBranch,
} from "./branch.js";
export { checkIgnore } from "./checkIgnore.js";
export type { GitCommand } from "./command.js";
export { amendCommit, commit } from "./commit.js";
export { getConflictStages, getFileContent, getStageContent } from "./content.js";
export { getIdentity, type Identity } from "./identity.js";
export {
  MergeOutcome,
  mergeRef,
  RebaseOutcome,
  type ReplayKind,
  ReplayOutcome,
  type ReplayResult,
  rebaseOnto,
  replayCommits,
} from "./integrate.js";
export { getRepositoryLocation, type RepositoryLocation } from "./location.js";
export { LockPolicy } from "./lock.js";
export {
  getCommitDetails,
  getCommitFiles,
  getHeadBases,
  getOutgoingCommits,
  getSkeleton,
  listAuthors,
  matchCommits,
  SKELETON_LIMIT,
} from "./log.js";
export {
  abortInProgress,
  ContinueOutcome,
  type ContinueResult,
  continueInProgress,
} from "./operation.js";
export { listPaths, type TrackedPath } from "./paths.js";
export { PushKind, type PushResult, push } from "./push.js";
export { getHead, getRefs } from "./refs.js";
export { addRemote, fetchAll, listRemotes } from "./remote.js";
export { ResetMode, resetTo } from "./reset.js";
export { addPaths, removeConflictPaths } from "./resolve.js";
export { RewordOutcome, rewordCommit } from "./reword.js";
export { rollback } from "./rollback.js";
export {
  applyStash,
  dropStash,
  getStashes,
  popStash,
  stashAll,
  stashPaths,
  unstage,
} from "./stash.js";
export { getStatus } from "./status.js";
export {
  FastForwardKind,
  type FastForwardResult,
  fastForward,
  fetchBranch,
  fetchInto,
} from "./update.js";
export { getGitVersion } from "./version.js";
