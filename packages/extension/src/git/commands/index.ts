/**
 * **所有 git 命令的唯一出口。** `git/` 以外只许从这里 import 命令（lint 强制，见 `biome.json`）。
 *
 * 想知道「我们到底对 git 跑了什么」，读这一张表就够，不必翻十几个文件。
 * 命令行本身留在各自的文件里：`--format=` 的字段顺序必须与解析代码紧挨着，
 * 所以 `log` / `status` 这类的参数在 `parsers/`，其余在 `commands/`。
 *
 * ## 最低支持 git 2.23
 *
 * 由下表「要求」一列的最高值决定。**新加一条命令就在表里加一行；某行要求超过 2.23 时，
 * 必须同时改 `DECISIONS.md`「最低 git 版本」。** 不做运行时版本检测（理由同上）。
 *
 * 所有命令还共用进程层强制注入的环境变量（`cli.ts` 的 `FORCED_ENV`），不涉及版本。
 *
 * | 命令 | 执行的 git | 较新的特性 | 要求 |
 * |---|---|---|---|
 * | `getRepositoryLocation` | `rev-parse --show-toplevel --absolute-git-dir --git-common-dir` | `--absolute-git-dir` | 2.13 |
 * | `getStatus` | `status --porcelain=v2 --branch -z -uall`，环境 `GIT_OPTIONAL_LOCKS=0` | `--porcelain=v2`；`GIT_OPTIONAL_LOCKS` | 2.11；2.15 |
 * | `checkIgnore` | `check-ignore -z --stdin` | — | — |
 * | `commit` | `add -- <未跟踪…>`（有才跑）+ `commit --only -F - -- <路径…>` | — | — |
 * | `amendCommit` | 同上，`commit --amend --only …`；路径可为空（只改说明） | — | — |
 * | `fetchAll` | `fetch --all --prune` | — | — |
 * | `listRemotes` | `remote` | — | — |
 * | `push` | `push [-u] <远程> refs/heads/<B>:refs/heads/<M>` | — | — |
 * | `fetchInto` | `fetch <远程> refs/heads/<M>:refs/heads/<B>`（拉取非当前分支） | — | — |
 * | `fetchBranch` | `fetch <远程> refs/heads/<M>`（拉取当前分支第一步） | — | — |
 * | `fastForward` | `merge --ff-only <远程分支记录>`（拉取当前分支第二步） | — | — |
 * | `switchBranch` | `switch <分支>` | `git switch` | 2.23 |
 * | `createTrackingBranch` | `switch -c <分支> --track <远程分支>` | `git switch` | 2.23 |
 * | `createBranch` | `switch -c <分支> --no-track <起点>` | `git switch` | 2.23 |
 * | `renameBranch` | `branch -m <旧名> <新名>` | — | — |
 * | `deleteBranch` | `branch -d <分支>` | — | — |
 * | `forceDeleteBranch` | `branch -D <分支>` | — | — |
 * | `deleteRemoteBranch` | `push <远程> --delete refs/heads/<分支>` | — | — |
 * | `isValidBranchName` | `check-ref-format --branch <名字>` | — | — |
 * | `getStashes` | `stash list -z --format=…` | — | — |
 * | `stashAll` | `stash push -u` | — | — |
 * | `stashPaths` | `stash push -u -- <路径…>` | — | — |
 * | `applyStash` | `stash apply <hash>` | — | — |
 * | `popStash` | `stash list …` 找序号 + `stash pop stash@{n}` | — | — |
 * | `dropStash` | `stash list …` 找序号 + `stash drop stash@{n}` | — | — |
 * | `unstage` | `restore --staged -- <路径…>` | `git restore` | 2.23 |
 * | `rollback` | `restore --source=HEAD --staged --worktree -- <路径…>` | `git restore` | **2.23** |
 * | `getSkeleton` | `-c log.showSignature=false log --format=… --max-count=10000 HEAD --branches --remotes --tags --date-order --`；按分支过滤时起点换成那个分支 | — | — |
 * | `getCommitDetails` | `-c log.showSignature=false log --format=… --no-walk --stdin` | — | — |
 * | `getRefs` | `for-each-ref --format=… refs/heads refs/remotes refs/tags` | `%(upstream:remotename)` / `%(upstream:remoteref)`（git 2.16.0 发布说明） | 2.16 |
 * | `getHead` | `rev-parse HEAD --symbolic-full-name HEAD` | — | — |
 * | `getFileContent` | `cat-file --filters <提交>:<路径>` | `--filters` | 2.11 |
 * | `getStageContent` | `cat-file --filters :<1/2/3>:<路径>` | `--filters` | 2.11 |
 * | `getConflictStages` | `ls-files -u -z -- :(literal)<路径>` | — | — |
 * | `matchCommits` | `-c log.showSignature=false log --format=%H --no-walk --stdin -F` + `-i --grep=<文字>` / `--author=<名字 <邮箱>>` / `-- :(literal)<路径>` | — | — |
 * | `listAuthors` | `-c log.showSignature=false log --format=%an%x00%ae --no-walk --stdin` | — | — |
 * | `listPaths` | `ls-files -z` | — | — |
 * | `getIdentity` | `config --get user.name` + `config --get user.email` | — | — |
 * | `getCommitFiles` | `-c log.showSignature=false log -1 -M --first-parent --format= --name-status -z <hash>` | — | — |
 *
 * `-c log.showSignature=false` 在不认识这个配置的旧 git 上是无害的空设置，不构成版本要求。
 */

export {
  createBranch,
  createTrackingBranch,
  DeleteBranchKind,
  type DeleteBranchResult,
  deleteBranch,
  deleteRemoteBranch,
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
export { getRepositoryLocation, type RepositoryLocation } from "./location.js";
export { LockPolicy } from "./lock.js";
export {
  getCommitDetails,
  getCommitFiles,
  getSkeleton,
  listAuthors,
  matchCommits,
  SKELETON_LIMIT,
} from "./log.js";
export { listPaths, type TrackedPath } from "./paths.js";
export {
  FastForwardKind,
  type FastForwardResult,
  fastForward,
  fetchBranch,
  fetchInto,
} from "./pull.js";
export { PushKind, type PushResult, push } from "./push.js";
export { getHead, getRefs } from "./refs.js";
export { fetchAll, listRemotes } from "./remote.js";
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
