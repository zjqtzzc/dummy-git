import { run } from "../failure.js";
import type { GitCommand } from "./command.js";
import { LockPolicy } from "./lock.js";

/**
 * 冲突文件标记已解决：`git add -- :(literal)<路径>`。暂存区里的三栏换成工作区里的内容，冲突组里就没了它。
 * 改 index，走本地道。`:(literal)`：路径里的 `*` 不当通配符。
 */
export const markResolvedPath: GitCommand<[repository: string, path: string], void> = {
  lock: LockPolicy.Exclusive,

  execute: async (cli, repository, path) => {
    await run(cli, ["add", "--", `:(literal)${path}`], { cwd: repository });
  },
};

/**
 * 冲突文件删掉并标记已解决：`git rm -q -- :(literal)<路径>`。工作区里有就一起删，没有（两边都删了）也行。
 * 改 index 与工作区，走本地道。
 */
export const removeConflictPath: GitCommand<[repository: string, path: string], void> = {
  lock: LockPolicy.Exclusive,

  execute: async (cli, repository, path) => {
    await run(cli, ["rm", "-q", "--", `:(literal)${path}`], { cwd: repository });
  },
};
