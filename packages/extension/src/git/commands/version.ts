import { run } from "../failure.js";
import type { GitCommand } from "./command.js";
import { LockPolicy } from "./lock.js";

/** git 自己报的版本：`git version 2.25.1`。只用来记进日志，不拿它做判断（不做运行时版本检测）。 */
export const getGitVersion: GitCommand<[cwd: string], string> = {
  lock: LockPolicy.None,

  execute: async (cli, cwd) => (await run(cli, ["--version"], { cwd })).stdout.trim(),
};
