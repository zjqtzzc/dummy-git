import { normalize } from "node:path";
import { run } from "../failure.js";
import type { GitCommand } from "./command.js";
import { LockPolicy } from "./lock.js";

/**
 * 找出仓库根目录。**整条链路的第一环。**
 *
 * 设计依据见 `.notes/design/M5-commands-operation.md` §9 与 `DECISIONS.md`
 * 「第一版只支持单仓库」。
 *
 * ## 为什么不去找 `./.git`
 *
 * 两个坑都是实测的：
 *
 * 1. **`.git` 可能是文件不是目录。** linked worktree 与 submodule 里它是个
 *    42 字节的文本文件（内容 `gitdir: …`）。按目录找，这两类直接被判成「不是仓库」——
 *    而用 IntelliJ 的人恰是 worktree 重度用户。
 * 2. **用户打开仓库子目录是常态。** 在 `repo/src/deep/` 下 `./.git` 根本不存在，
 *    而 `rev-parse --show-toplevel` 正确返回 `repo`。
 *
 * 成本完全一样（都是一步），而且 git 返回的规范化根路径**就是**我们的仓库标识，
 * 省掉自己定义规则。vscode 同此做法（`git.ts:505`）。
 *
 * ## 它是唯一不接收 `repo` 参数的命令
 *
 * 别的命令都以「哪个仓库」开头，因为那是已知的。这一条**产出**仓库，
 * 所以它接收的是「一个可能在仓库里的路径」——通常是 workspace folder。
 */
export const getRepositoryRoot: GitCommand<[pathInsideRepository: string], string> = {
  // 纯查询：不碰 index、不碰工作区，和谁都不抢。
  lock: LockPolicy.None,

  execute: async (cli, pathInsideRepository) => {
    // 不是仓库时 git 以非零码退出，`run()` 会抛 `GitFailureError`，
    // 其 `code` 为 `NotAGitRepository`——调用方据此给提示，不必读 stderr 文本。
    const result = await run(cli, ["rev-parse", "--show-toplevel"], {
      cwd: pathInsideRepository,
    });

    // 只剥掉结尾的换行，**不 trim 结尾空格**——目录名可以以空格结尾，
    // 把它当成噪声剪掉会得到一个不存在的路径。vscode 在同一处也这么做。
    return normalize(result.stdout.trimStart().replace(/[\r\n]+$/, ""));
  },
};
