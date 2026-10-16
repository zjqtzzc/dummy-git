import { run } from "../failure.js";
import type { GitCommand } from "./command.js";
import { LockPolicy } from "./lock.js";

/**
 * 把勾选的已跟踪文件恢复成 HEAD 的样子：暂存区与工作区一起（第 2 阶段 Rollback）。
 *
 * 一条 `restore --source=HEAD --staged --worktree` 覆盖四种情况（实测 git 2.43）：
 * 修改的还原、删除的恢复、新增的（HEAD 里没有）从暂存区去掉**并删掉磁盘上的文件**、
 * 改名的新路径删掉而旧路径恢复——改名要把新旧两个路径都传进来。
 *
 * 未跟踪文件不归它管（`restore` 也不碰它们），见需求：它们用第 7 阶段右键菜单的 Delete。
 * `git restore` 从 2.23 起才有，在最低版本 2.25 之内（`DECISIONS.md`）。
 */
export const rollback: GitCommand<[repository: string, paths: readonly string[]], void> = {
  // 改 index 也改工作区，必须与别的写命令互斥。
  lock: LockPolicy.Exclusive,

  execute: async (cli, repository, paths) => {
    await run(cli, ["restore", "--source=HEAD", "--staged", "--worktree", "--", ...paths], {
      cwd: repository,
    });
  },
};
