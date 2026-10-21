import { runRaw } from "../failure.js";
import { mailmapArgs, parseMailmapContact } from "../parsers/index.js";
import type { GitCommand } from "./command.js";
import { LockPolicy } from "./lock.js";

/** git 配置里的「我」：`user.name` 与 `user.email`，按仓库的 mailmap 换算过。 */
export interface Identity {
  readonly name: string;
  readonly email: string;
}

/**
 * 读「我」是谁（User 过滤的 Me）：`git config --get user.name` / `user.email`，按仓库的配置（含全局）。
 * 名字没配就是没有「我」，返回 `undefined`；邮箱没配是空串（git 允许，作者那一行就是 `名字 <>`）。
 * 再按仓库的 mailmap 换算：列表里的作者、`--author` 比的都是换算过的，「我」也得是。
 */
export const getIdentity: GitCommand<[repository: string], Identity | undefined> = {
  lock: LockPolicy.None,

  execute: async (cli, repository) => {
    const [name, email] = await Promise.all(
      ["user.name", "user.email"].map(async (key) => {
        // 没配时 git 以 1 退出、什么都不输出，不算失败。
        const result = await cli.exec(["config", "--get", key], { cwd: repository });
        return result.exitCode === 0 ? result.stdout.trim() : "";
      }),
    );
    if (name === undefined || name === "") return undefined;
    const result = await runRaw(cli, mailmapArgs(name, email ?? ""), { cwd: repository });
    return parseMailmapContact(result.stdout);
  },
};
