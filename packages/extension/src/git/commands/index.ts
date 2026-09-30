/**
 * **所有 git 命令的唯一出口。** `git/` 以外只许从这里 import 命令（lint 强制，见 `biome.json`）。
 *
 * 想知道「我们到底对 git 跑了什么」，读这一张表就够，不必翻十几个文件。
 * 命令行本身留在各自的文件里：`--format=` 的字段顺序必须与解析代码紧挨着，
 * 所以 `log` / `status` 这类的参数在 `parsers/`，其余在 `commands/`。
 *
 * ## 最低支持 git 2.16
 *
 * 由下表「要求」一列的最高值决定。**新加一条命令就在表里加一行；某行要求超过 2.16 时，
 * 必须同时改 `DECISIONS.md`「最低 git 版本」。** 不做运行时版本检测（理由同上）。
 *
 * 所有命令还共用进程层强制注入的环境变量（`cli.ts` 的 `FORCED_ENV`），不涉及版本。
 *
 * | 命令 | 执行的 git | 较新的特性 | 要求 |
 * |---|---|---|---|
 * | `getRepositoryLocation` | `rev-parse --show-toplevel --absolute-git-dir --git-common-dir` | `--absolute-git-dir` | 2.13 |
 * | `getStatus` | `status --porcelain=v2 --branch -z -uall`，环境 `GIT_OPTIONAL_LOCKS=0` | `--porcelain=v2`；`GIT_OPTIONAL_LOCKS` | 2.11；2.15 |
 * | `checkIgnore` | `check-ignore -z --stdin` | — | — |
 * | `commit` | `commit --only -F - -- <路径…>` | — | — |
 * | `getSkeleton` | `-c log.showSignature=false log --format=… --max-count=10000 HEAD --branches --remotes --tags --date-order` | — | — |
 * | `getCommitDetails` | `-c log.showSignature=false log --format=… --no-walk --stdin` | — | — |
 * | `getRefs` | `for-each-ref --format=… refs/heads refs/remotes refs/tags` | `%(upstream:remotename)` / `%(upstream:remoteref)`（git 2.16.0 发布说明） | **2.16** |
 * | `getHead` | `rev-parse HEAD --symbolic-full-name HEAD` | — | — |
 * | `getFileContent` | `cat-file --filters <提交>:<路径>` | `--filters` | 2.11 |
 * | `getCommitFiles` | `-c log.showSignature=false log -1 -M --first-parent --format= --name-status -z <hash>` | — | — |
 *
 * `-c log.showSignature=false` 在不认识这个配置的旧 git 上是无害的空设置，不构成版本要求。
 */

export { checkIgnore } from "./checkIgnore.js";
export type { GitCommand } from "./command.js";
export { commit } from "./commit.js";
export { getFileContent } from "./content.js";
export { getRepositoryLocation, type RepositoryLocation } from "./location.js";
export { LockPolicy } from "./lock.js";
export { getCommitDetails, getCommitFiles, getSkeleton, SKELETON_LIMIT } from "./log.js";
export { getHead, getRefs } from "./refs.js";
export { getStatus } from "./status.js";
