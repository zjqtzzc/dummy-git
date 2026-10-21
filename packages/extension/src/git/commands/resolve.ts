import { run } from "../failure.js";
import type { GitCommand } from "./command.js";
import { LockPolicy } from "./lock.js";

/**
 * 把工作区里的这几份写进暂存区：`git add -- :(literal)<路径>…`，一条命令。
 * 冲突文件用它标记已解决（暂存区里的三栏换成工作区里的内容，冲突组里就没了它）；未跟踪文件用它 Add to Git。
 * 改 index，走本地道。`:(literal)`：路径里的 `*` 不当通配符。
 */
export const addPaths: GitCommand<[repository: string, paths: readonly string[]], void> = {
  lock: LockPolicy.Exclusive,

  execute: async (cli, repository, paths) => {
    const specs = paths.map((path) => `:(literal)${path}`);
    await run(cli, ["add", "--", ...specs], { cwd: repository });
  },
};

/**
 * 冲突文件删掉并标记已解决：`git rm -q -- :(literal)<路径>…`，一条命令。工作区里有就一起删，没有（两边都删了）也行。
 * 改 index 与工作区，走本地道。
 */
export const removeConflictPaths: GitCommand<[repository: string, paths: readonly string[]], void> =
  {
    lock: LockPolicy.Exclusive,

    execute: async (cli, repository, paths) => {
      const specs = paths.map((path) => `:(literal)${path}`);
      await run(cli, ["rm", "-q", "--", ...specs], { cwd: repository });
    },
  };
