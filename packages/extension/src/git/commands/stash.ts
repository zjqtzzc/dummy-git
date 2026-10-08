import { run } from "../failure.js";
import type { GitCommand } from "./command.js";
import { LockPolicy } from "./lock.js";

/**
 * 存全部改动：`git stash push -u`，未跟踪文件一起存。说明用 git 自动生成的。
 * 返回 git 自己说的那句（`Saved working directory and index state WIP on main: …`；
 * 什么改动都没有时是 `No local changes to save`）。改暂存区与工作区，走本地道。
 */
export const stashAll: GitCommand<[repository: string], string> = {
  lock: LockPolicy.Exclusive,

  execute: async (cli, repository) => {
    const { stdout } = await run(cli, ["stash", "push", "-u"], { cwd: repository });
    return firstLine(stdout);
  },
};

/**
 * 只存这些路径：`git stash push -u -- <路径…>`。勾了的未跟踪文件一起存；没勾的原样留下。
 *
 * 坑：路径里有**已暂存的删除**（改名的旧路径、`git rm` 过的文件）时，git 先存下 stash、
 * 再在清理工作区时报 `pathspec did not match` 退出——stash 建了，改动还留在工作区（实测 git 2.43）。
 * 所以调用方要先用 `unstage` 把它们退回成未暂存的删除。
 */
export const stashPaths: GitCommand<[repository: string, paths: readonly string[]], string> = {
  lock: LockPolicy.Exclusive,

  execute: async (cli, repository, paths) => {
    const { stdout } = await run(cli, ["stash", "push", "-u", "--", ...paths], {
      cwd: repository,
    });
    return firstLine(stdout);
  },
};

/** 把这些路径从暂存区退回（`git restore --staged`），工作区不动。改 index，走本地道。 */
export const unstage: GitCommand<[repository: string, paths: readonly string[]], void> = {
  lock: LockPolicy.Exclusive,

  execute: async (cli, repository, paths) => {
    await run(cli, ["restore", "--staged", "--", ...paths], { cwd: repository });
  },
};

function firstLine(text: string): string {
  return text.split("\n")[0]?.trim() ?? "";
}
