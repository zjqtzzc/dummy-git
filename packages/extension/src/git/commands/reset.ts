import { run } from "../failure.js";
import type { GitCommand } from "./command.js";
import { LockPolicy } from "./lock.js";

/** reset 的四种做法，按对文件的影响从小到大。 */
export enum ResetMode {
  /** 只动分支：差异留在暂存区。 */
  Soft = "soft",
  /** 分支与暂存区：差异留在工作区、不暂存。 */
  Mixed = "mixed",
  /** 文件回到那条提交，本地改动保留；保不住时 git 拒绝。 */
  Keep = "keep",
  /** 分支、暂存区、工作区全回到那条提交，本地改动丢掉。 */
  Hard = "hard",
}

/** 模式 → git 的选项。 */
const FLAG: Readonly<Record<ResetMode, string>> = {
  [ResetMode.Soft]: "--soft",
  [ResetMode.Mixed]: "--mixed",
  [ResetMode.Keep]: "--keep",
  [ResetMode.Hard]: "--hard",
};

/**
 * 把当前分支（detached 时是 HEAD）reset 到 `hash`：`git reset -q --<模式> <hash>`。
 * 任意提交都行，不要求在当前分支上。Keep 遇到保不住的本地改动时 git 以非 0 退出、什么都不动，原样抛出。
 * 改分支、暂存区、工作区，走本地道。
 */
export const resetTo: GitCommand<[repository: string, mode: ResetMode, hash: string], void> = {
  lock: LockPolicy.Exclusive,

  execute: async (cli, repository, mode, hash) => {
    await run(cli, ["reset", "-q", FLAG[mode], hash], { cwd: repository });
  },
};
