import { realpath } from "node:fs/promises";
import { normalize, resolve } from "node:path";
import { run } from "../failure.js";
import type { GitCommand } from "./command.js";
import { LockPolicy } from "./lock.js";

/**
 * 一个仓库在磁盘上的位置。**凡是要碰仓库目录的代码，路径只从这里取。**
 *
 * 不许在别处拼 `<根目录>/.git/…`：linked worktree 与 submodule 里 `.git` 是个
 * 文本文件（内容 `gitdir: …`），真正的 git 目录在别处。写死 `.git` 的代码在那里
 * **静默失效**——不报错，只是什么都读不到、什么都监听不到。
 */
export interface RepositoryLocation {
  /** 工作树的根目录。同时是这个仓库的标识。 */
  readonly root: string;
  /**
   * 本工作树专属的 git 目录。`HEAD`、`index`、`MERGE_HEAD`、`rebase-merge/` 在这里。
   * 普通仓库是 `<根>/.git`；linked worktree 是 `<主仓库>/.git/worktrees/<名字>`。
   */
  readonly gitDir: string;
  /**
   * 几个工作树共享的 git 目录。`refs/`、`packed-refs`、`config` 在这里。
   * 普通仓库与 `gitDir` 相同。
   */
  readonly commonDir: string;
}

/**
 * 从一个「可能在仓库里的路径」（通常是 workspace folder）问出仓库位置。**整条链路的第一环。**
 *
 * ## 一次 `rev-parse` 问全
 *
 * 三个参数的输出按参数顺序一行一个。
 *
 * - `--show-toplevel`：从子目录也能往上找到根，不用自己找 `./.git`。
 * - `--absolute-git-dir`：直接给绝对路径（git 2.13 起）。
 * - `--git-common-dir`：**相对的是执行目录**（实测：根目录下给 `.git`，
 *   `x/y/` 下给 `../../.git`；worktree 里给绝对路径）。git 直到 2.31 才有
 *   `--path-format=absolute`，而最低版本定在 2.25，所以自己解析。
 *
 * 另外两个是 git 给的真实路径（符号链接已展开），解析出来的这个也 `realpath` 一次，
 * 三者口径一致。
 *
 * ## 它是唯一不接收 `repo` 参数的命令
 *
 * 别的命令都以「哪个仓库」开头，因为那是已知的。这一条**产出**仓库。
 */
export const getRepositoryLocation: GitCommand<[pathInsideRepository: string], RepositoryLocation> =
  {
    // 纯查询：不碰 index、不碰工作区，和谁都不抢。
    lock: LockPolicy.None,

    execute: async (cli, pathInsideRepository) => {
      // 不是仓库时 git 以非零码退出，`run()` 会抛 `GitFailureError`，
      // 其 `code` 为 `NotAGitRepository`——调用方据此给提示，不必读 stderr 文本。
      const result = await run(
        cli,
        ["rev-parse", "--show-toplevel", "--absolute-git-dir", "--git-common-dir"],
        { cwd: pathInsideRepository },
      );

      // 只按换行切，**不 trim 行尾空格**——目录名可以以空格结尾，
      // 当成噪声剪掉会得到一个不存在的路径。vscode 在同一处也这么做。
      const [root, gitDir, commonDir] = result.stdout.replace(/[\r\n]+$/, "").split(/\r?\n/);
      if (root === undefined || gitDir === undefined || commonDir === undefined) {
        throw new Error(`rev-parse 应输出三行，实际：${JSON.stringify(result.stdout)}`);
      }

      return {
        root: normalize(root),
        gitDir: normalize(gitDir),
        commonDir: await realpath(resolve(pathInsideRepository, commonDir)),
      };
    },
  };
