import type { Stash } from "@dummy-git/shared";
import type { GitCli } from "../cli.js";
import { run, runRaw } from "../failure.js";
import { parseStashList, stashListArgs } from "../parsers/index.js";
import type { GitCommand } from "./command.js";
import { LockPolicy } from "./lock.js";

/** 全部 stash，最新的在最前。读命令，不排队。 */
export const getStashes: GitCommand<[repository: string], Stash[]> = {
  lock: LockPolicy.None,

  execute: async (cli, repository) => {
    const result = await runRaw(cli, stashListArgs(), { cwd: repository });
    return parseStashList(result.stdout);
  },
};

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
 * 坑一：`stash push -- <路径>` 只按路径清理工作区，存进去的却是**整个暂存区**——
 * 没勾的已暂存改动（新增、改名、删除）会一起进 stash，同时还留在工作区，Apply 时再来一遍
 * （实测 git 2.25、2.43）。所以先记下暂存区（`write-tree`），把没勾的已暂存路径退回成未暂存，
 * stash 完再从记下的那棵树原样还原暂存区（部分暂存的文件也还原成暂存的那一版）。
 * stash 失败也还原。四步在同一条本地道命令里，中间插不进我们自己的别的写操作。
 *
 * 坑二：路径里有**已暂存的删除**（改名的旧路径、`git rm` 过的文件）时，git 先存下 stash、
 * 再在清理工作区时报 `pathspec did not match` 退出——stash 建了，改动还留在工作区（实测 git 2.43）。
 * 所以调用方要先用 `unstage` 把它们退回成未暂存的删除。
 */
export const stashPaths: GitCommand<[repository: string, paths: readonly string[]], string> = {
  lock: LockPolicy.Exclusive,

  execute: async (cli, repository, paths) => {
    const options = { cwd: repository };
    const index = (await run(cli, ["write-tree"], options)).stdout.trim();
    // 不写 HEAD：还没有提交的仓库也能跑（对空树比），stash 自己再报「没有初始提交」。
    const staged = await run(
      cli,
      ["diff", "--cached", "--name-only", "--no-renames", "-z"],
      options,
    );
    const selected = new Set(paths);
    const others = staged.stdout.split("\0").filter((path) => path !== "" && !selected.has(path));
    if (others.length > 0) await run(cli, ["restore", "--staged", "--", ...others], options);
    try {
      const { stdout } = await run(cli, ["stash", "push", "-u", "--", ...paths], options);
      return firstLine(stdout);
    } finally {
      if (others.length > 0) {
        await run(cli, ["restore", `--source=${index}`, "--staged", "--", ...others], options);
      }
    }
  },
};

/** 把这些路径从暂存区退回（`git restore --staged`），工作区不动。改 index，走本地道。 */
export const unstage: GitCommand<[repository: string, paths: readonly string[]], void> = {
  lock: LockPolicy.Exclusive,

  execute: async (cli, repository, paths) => {
    await run(cli, ["restore", "--staged", "--", ...paths], { cwd: repository });
  },
};

/**
 * 把这条 stash 取回工作区，stash 保留：`git stash apply <hash>`。冲突时 git 报错（原样抛出），
 * 工作区里留下冲突标记，stash 仍在。改工作区，走本地道。
 */
export const applyStash: GitCommand<[repository: string, hash: string], void> = {
  lock: LockPolicy.Exclusive,

  execute: async (cli, repository, hash) => {
    await run(cli, ["stash", "apply", hash], { cwd: repository });
  },
};

/**
 * 取回并删掉：`git stash pop stash@{n}`。git 自己保证只在取回成功时删，冲突时 stash 留着。
 * pop / drop 只认 `stash@{n}`、不认 hash，序号又会随增删而变，所以在同一条命令里先按 hash 找序号再执行，
 * 中间插不进我们自己的别的写操作。
 */
export const popStash: GitCommand<[repository: string, hash: string], void> = {
  lock: LockPolicy.Exclusive,

  execute: async (cli, repository, hash) => {
    await run(cli, ["stash", "pop", await stashRef(cli, repository, hash)], { cwd: repository });
  },
};

/** 删掉这条 stash：`git stash drop stash@{n}`（序号同 `popStash` 按 hash 找）。返回 git 自己说的那句。 */
export const dropStash: GitCommand<[repository: string, hash: string], string> = {
  lock: LockPolicy.Exclusive,

  execute: async (cli, repository, hash) => {
    const ref = await stashRef(cli, repository, hash);
    const { stdout } = await run(cli, ["stash", "drop", ref], { cwd: repository });
    return firstLine(stdout);
  },
};

/** 这条 stash 现在的 `stash@{n}`。已经不在（别处删了）时抛出。 */
async function stashRef(cli: GitCli, repository: string, hash: string): Promise<string> {
  const result = await runRaw(cli, stashListArgs(), { cwd: repository });
  const index = parseStashList(result.stdout).findIndex((stash) => stash.hash === hash);
  if (index === -1) throw new Error(`The stash ${hash.slice(0, 7)} no longer exists.`);
  return `stash@{${index}}`;
}

function firstLine(text: string): string {
  return text.split("\n")[0]?.trim() ?? "";
}
