import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Stash } from "@dummy-git/shared";
import type { GitCli } from "../cli.js";
import { run, runRaw } from "../failure.js";
import { parseStashList, stashListArgs } from "../parsers/stash.js";
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
 * 只存这些路径：`git stash push -u [-m <说明>] -- <路径…>`。选中的未跟踪文件一起存；没选的原样留下。
 * `message` 缺席或空串就不传 `-m`，说明用 git 自动生成的。
 *
 * 坑一：`stash push -- <路径>` 只按路径清理工作区，存进去的却是**整个暂存区**——
 * 没选的已暂存改动（新增、改名、删除）会一起进 stash，同时还留在工作区，Apply 时再来一遍
 * （实测 git 2.25、2.43）。所以先记下暂存区（`write-tree`），把没选的已暂存路径退回成未暂存，
 * stash 完再从记下的那棵树原样还原暂存区（部分暂存的文件也还原成暂存的那一版）。
 * stash 失败也还原。几步在同一条本地道命令里，中间插不进我们自己的别的写操作。
 *
 * 坑二：路径里有**已暂存的删除**（改名的旧路径、`git rm` 过的文件）时，git 先存下 stash、
 * 再在清理工作区时报 `pathspec did not match` 退出——stash 建了，改动还留在工作区（实测 git 2.43）。
 * 所以 stash 之前把它们退回成未暂存的删除。代价：Apply 回来后改名显示成新增 + 删除两行。
 *
 * 收尾还原暂存区失败不盖住 stash 的结果：成功就当成功，失败仍抛原来的错。
 */
export const stashPaths: GitCommand<
  [repository: string, paths: readonly string[], message?: string],
  string
> = {
  lock: LockPolicy.Exclusive,

  execute: async (cli, repository, paths, message) => {
    const options = { cwd: repository };
    const index = (await run(cli, ["write-tree"], options)).stdout.trim();
    const staged = await run(
      cli,
      ["diff", "--cached", "--name-status", "--no-renames", "-z"],
      options,
    );
    const selected = new Set(paths);
    const others: string[] = [];
    const selectedDeletions: string[] = [];
    const tokens = staged.stdout.split("\0");
    for (let i = 0; i + 1 < tokens.length; i += 2) {
      const status = tokens[i];
      const path = tokens[i + 1];
      if (status === undefined || path === undefined || path === "") continue;
      if (!selected.has(path)) others.push(path);
      else if (status === "D") selectedDeletions.push(path);
    }
    const unstageNow = [...others, ...selectedDeletions];
    const restoreIndex = async (list: readonly string[]) => {
      if (list.length === 0) return;
      await run(
        cli,
        ["restore", `--source=${index}`, "--staged", "--", ...list.map(literal)],
        options,
      );
    };
    try {
      if (unstageNow.length > 0) {
        await run(cli, ["restore", "--staged", "--", ...unstageNow.map(literal)], options);
      }
      const named = message !== undefined && message !== "" ? ["-m", message] : [];
      const { stdout } = await run(
        cli,
        ["stash", "push", "-u", ...named, "--", ...paths.map(literal)],
        options,
      );
      await restoreIndex(others).catch(() => undefined);
      return firstLine(stdout);
    } catch (error) {
      await restoreIndex(unstageNow).catch(() => undefined);
      throw error;
    }
  },
};

/** 把这些路径从暂存区退回（`git restore --staged`），工作区不动。改 index，走本地道。 */
export const unstage: GitCommand<[repository: string, paths: readonly string[]], void> = {
  lock: LockPolicy.Exclusive,

  execute: async (cli, repository, paths) => {
    await run(cli, ["restore", "--staged", "--", ...paths.map(literal)], { cwd: repository });
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
 * 只取回这条 stash 里的几个文件，stash 保留。git 没有这个命令，所以拼一条只含它们的临时 stash，
 * 交给 `git stash apply`：冲突、被本地改动挡住都和整条取回一样（冲突进暂存区；挡住时 git 报错，原样抛出）。
 *
 * - 已跟踪的 `paths`：在临时暂存区里读进存时所在的提交（`^1`），这些路径换成 stash 里的样子
 *   （stash 里没有的就删掉：删除、改名的旧路径），写成树。
 * - 未跟踪的 `untracked`：另一棵只含它们的树，做成第三个父提交，git 认 stash 的未跟踪部分就靠它。
 * - 第二个父提交（存时的暂存区）用原来那条的：不带 `--index` 时 git 不读它。
 *
 * 临时提交不 `stash store`，不进列表，没有引用，由 gc 回收。改工作区，走本地道。
 * 否决 `restore --source=<stash>` 直接覆盖：本地改动丢掉，存完以后 HEAD 上的改动也被悄悄撤掉。
 * 否决 `diff | apply`：一块对不上就整份失败、不留冲突标记；`--3way` 又要求文件与暂存区一致，
 * 有未暂存改动就报 `does not match index`（实测 git 2.43）。
 */
export const applyStashFiles: GitCommand<
  [repository: string, hash: string, paths: readonly string[], untracked: readonly string[]],
  void
> = {
  lock: LockPolicy.Exclusive,

  execute: async (cli, repository, hash, paths, untracked) => {
    const options = { cwd: repository };
    const dir = await mkdtemp(join(tmpdir(), "dummy-git-stash-"));
    const scratch = { cwd: repository, env: { GIT_INDEX_FILE: join(dir, "index") } };
    /** 在临时暂存区里读进 `start`，`list` 换成 `source` 里的样子，写成树。 */
    const tree = async (start: string, source: string, list: readonly string[]) => {
      await run(cli, ["read-tree", start], scratch);
      if (list.length > 0) {
        await run(
          cli,
          ["restore", `--source=${source}`, "--staged", "--", ...list.map(literal)],
          scratch,
        );
      }
      return (await run(cli, ["write-tree"], scratch)).stdout.trim();
    };
    const commitTree = async (treeHash: string, parents: readonly string[]) => {
      const flags = parents.flatMap((parent) => ["-p", parent]);
      return (
        await run(cli, ["commit-tree", treeHash, ...flags, "-m", "partial"], options)
      ).stdout.trim();
    };
    try {
      const parents = [`${hash}^1`, `${hash}^2`];
      if (untracked.length > 0) {
        parents.push(await commitTree(await tree("--empty", `${hash}^3`, untracked), []));
      }
      const partial = await commitTree(await tree(`${hash}^1`, hash, paths), parents);
      await run(cli, ["stash", "apply", partial], options);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
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

/**
 * 改这条 stash 的说明。git 没有 rename，所以按 hash 找到现在的 `stash@{n}`，
 * 先 drop 再 `stash store -m <说明> <hash>`（提交本身不动）。同一 hash 不能在列表里出现两次，
 * 先 store 再按 hash drop 会删掉新的那条。store 总是加到 reflog 头上，改完这条排到最前。
 * 只改 reflog，不改工作区。
 */
export const renameStash: GitCommand<[repository: string, hash: string, message: string], void> = {
  lock: LockPolicy.Exclusive,

  execute: async (cli, repository, hash, message) => {
    const ref = await stashRef(cli, repository, hash);
    const options = { cwd: repository };
    await run(cli, ["stash", "drop", ref], options);
    await run(cli, ["stash", "store", "-m", message, hash], options);
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

/** 路径里的 `*`、`?`、`[]` 不当通配符。 */
function literal(path: string): string {
  return `:(literal)${path}`;
}
