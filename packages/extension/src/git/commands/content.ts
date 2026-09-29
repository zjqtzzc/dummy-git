import { runRaw } from "../failure.js";
import type { GitCommand } from "./command.js";
import { LockPolicy } from "./lock.js";

/**
 * 某个版本的某个文件，原始字节。diff 左右两边的历史版本内容由它提供。
 *
 * ## `cat-file --filters`，不是 `git show`
 *
 * `--filters` 让 git 做与检出时相同的转换：换行符（`core.autocrlf`、`.gitattributes`
 * 的 `eol`）和 smudge 过滤器（如 Git LFS——不加只能读到几行的指针文件）。
 * 这样历史版本与工作区里的写法一致，以后拿它和工作区比较时，不会整个文件每一行都显示成改动。
 * IDEA 默认同样带 `--filters`（`git.read.content.with` 默认 `FILTERS`）。
 *
 * ## 返回字节，不解码
 *
 * 由 VS Code 按用户的编码设置解码（`ARCHITECTURE.md` 第 10 题）。在这里解成 UTF-8，
 * GBK 之类的文件就成了乱码。
 *
 * `path` 是相对仓库根、以 `/` 分隔的路径。文件在这个版本里不存在时 git 以非零码退出，
 * 抛 `GitFailureError`——调用方（diff 的新增 / 删除一侧）本来就不该为它来问。
 */
export const getFileContent: GitCommand<
  [repository: string, revision: string, path: string],
  Buffer
> = {
  lock: LockPolicy.None,

  execute: async (cli, repository, revision, path) => {
    const result = await runRaw(cli, ["cat-file", "--filters", `${revision}:${path}`], {
      cwd: repository,
    });
    return result.stdout;
  },
};
