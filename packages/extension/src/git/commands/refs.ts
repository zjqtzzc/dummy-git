import type { Ref } from "@dummy-git/shared";
import { runRaw } from "../failure.js";
import { headArgs, parseHead, parseRefs, refsArgs } from "../parsers/refs.js";
import type { GitCommand } from "./command.js";
import { LockPolicy } from "./lock.js";

/** 本地分支、远程分支、tag。HEAD 不在 `refs/` 下，`for-each-ref` 列不到，见 `getHead`。 */
export const getRefs: GitCommand<[repository: string], Ref[]> = {
  lock: LockPolicy.None,

  execute: async (cli, repository) => {
    const result = await runRaw(cli, refsArgs(), { cwd: repository });
    return parseRefs(result.stdout);
  },
};

/** HEAD 指向哪条提交、在哪个分支上；detached 时没有分支。 */
export const getHead: GitCommand<[repository: string], Ref> = {
  lock: LockPolicy.None,

  execute: async (cli, repository) => {
    const result = await runRaw(cli, headArgs(), { cwd: repository });
    return parseHead(result.stdout);
  },
};
