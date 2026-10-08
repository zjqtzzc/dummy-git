import { run } from "../failure.js";
import type { GitCommand } from "./command.js";
import { LockPolicy } from "./lock.js";

/**
 * 切到一个本地分支：`git switch <B>`。返回 git 自己说的那句（`Switched to branch 'B'`），作完成消息。
 *
 * 用 `switch` 不用 `checkout`：`checkout` 兼管恢复文件，参数稍有歧义就会去改文件；`switch` 只做切换。
 * 改工作区，走本地道。工作区改动挡住时 git 拒绝（`would be overwritten by checkout`），原样抛出。
 */
export const switchBranch: GitCommand<[repository: string, branch: string], string> = {
  lock: LockPolicy.Exclusive,

  execute: async (cli, repository, branch) => {
    const { stderr } = await run(cli, ["switch", branch], { cwd: repository });
    return firstLine(stderr);
  },
};

function firstLine(text: string): string {
  return text.split("\n")[0]?.trim() ?? "";
}
