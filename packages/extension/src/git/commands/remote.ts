import { run } from "../failure.js";
import type { GitCommand } from "./command.js";
import { LockPolicy } from "./lock.js";

/**
 * 取全部远程，并清掉远程上已删除的分支的记录（`--prune`）。
 *
 * 网络命令走远程道：它写远程分支记录，和别的网络命令同时跑会撞引用锁；
 * 但不碰暂存区与工作区，不挡本地道。
 */
export const fetchAll: GitCommand<[repository: string], void> = {
  lock: LockPolicy.Remote,

  execute: async (cli, repository) => {
    await run(cli, ["fetch", "--all", "--prune"], { cwd: repository });
  },
};

/** 全部远程的名字（`git remote`）。推送一个没有上游的分支、要挑远程时才问。只读。 */
export const listRemotes: GitCommand<[repository: string], string[]> = {
  lock: LockPolicy.None,

  execute: async (cli, repository) => {
    const { stdout } = await run(cli, ["remote"], { cwd: repository });
    return stdout.split("\n").filter((line) => line !== "");
  },
};
