import { run } from "../failure.js";
import type { GitCommand } from "./command.js";
import { LockPolicy } from "./lock.js";

/**
 * 取全部远程。`prune` 时顺带清掉远程上已删除的分支的记录（`--prune`）；带不带由调用方写明，没有默认值。
 *
 * 网络命令走远程道：它写远程分支记录，和别的网络命令同时跑会撞引用锁；
 * 但不碰暂存区与工作区，不挡本地道。
 */
export const fetchAll: GitCommand<[repository: string, options: { prune: boolean }], void> = {
  lock: LockPolicy.Remote,

  execute: async (cli, repository, { prune }) => {
    await run(cli, ["fetch", "--all", ...(prune ? ["--prune"] : [])], { cwd: repository });
  },
};

/** 全部远程的名字（`git remote`）。推送对话框的远程下拉用。只读。 */
export const listRemotes: GitCommand<[repository: string], string[]> = {
  lock: LockPolicy.None,

  execute: async (cli, repository) => {
    const { stdout } = await run(cli, ["remote"], { cwd: repository });
    return stdout.split("\n").filter((line) => line !== "");
  },
};

/**
 * 加一个远程（`git remote add`）。推送对话框里，仓库一个远程都没有时用。
 * 名字或地址不对由 git 报错。`--` 之后的名字不会被当成选项。
 * 走远程道：它改远程的配置，紧接着的推送也在这条道上，不会和 fetch 交错。
 */
export const addRemote: GitCommand<[repository: string, name: string, url: string], void> = {
  lock: LockPolicy.Remote,

  execute: async (cli, repository, name, url) => {
    await run(cli, ["remote", "add", "--", name, url], { cwd: repository });
  },
};
