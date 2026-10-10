import { IndexStage } from "@dummy-git/shared";
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

/**
 * 冲突时暂存区某一栏里的这个文件（合并编辑器的三栏）：`git cat-file --filters :<1|2|3>:<路径>`。
 * 这一栏不存在时（两边都新增的没有基准）git 报错，调用方先用 `getConflictStages` 问清有哪几栏。
 *
 * 和提交里的内容不同，它不是永远不变的：标记已解决（`git add`）后这几栏就没了。
 */
export const getStageContent: GitCommand<
  [repository: string, stage: IndexStage, path: string],
  Buffer
> = {
  lock: LockPolicy.None,

  execute: async (cli, repository, stage, path) => {
    const result = await runRaw(cli, ["cat-file", "--filters", `:${STAGE_NUMBER[stage]}:${path}`], {
      cwd: repository,
    });
    return result.stdout;
  },
};

/** 冲突的这个路径在暂存区里有哪几栏：`git ls-files -u -z -- <路径>`。没有冲突时是空的。 */
export const getConflictStages: GitCommand<[repository: string, path: string], IndexStage[]> = {
  lock: LockPolicy.None,

  execute: async (cli, repository, path) => {
    const result = await runRaw(cli, ["ls-files", "-u", "-z", "--", `:(literal)${path}`], {
      cwd: repository,
    });
    // 每条是 `<mode> <hash> <栏号>\t<路径>`。
    const numbers = new Set(
      result.stdout
        .toString("utf8")
        .split("\0")
        .map((record) => record.split("\t")[0]?.split(" ")[2]),
    );
    return Object.values(IndexStage).filter((stage) => numbers.has(STAGE_NUMBER[stage]));
  },
};

/** 栏在 git 里的编号：`:1:` 基准、`:2:` 我们这边、`:3:` 对方。 */
const STAGE_NUMBER: Readonly<Record<IndexStage, string>> = {
  [IndexStage.Base]: "1",
  [IndexStage.Ours]: "2",
  [IndexStage.Theirs]: "3",
};
