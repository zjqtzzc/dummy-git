import { run, runRaw } from "../failure.js";
import { chainArgs, commitObjectArgs, parseChain, parseCommitObject } from "../parsers/rewrite.js";
import type { GitCommand } from "./command.js";
import { LockPolicy } from "./lock.js";

export enum RewordOutcome {
  Reworded = "reworded",
  /** 那条不在 HEAD 的第一父提交链上，或它到 HEAD 之间（含它）有合并提交。什么都没动。 */
  NotLinear = "notLinear",
}

/**
 * 改一条提交的说明，在内存里造提交（`ARCHITECTURE.md` 第 21 题）。
 *
 * 只改说明、内容（tree）不变：从 `target` 到 HEAD，按从旧到新逐条
 * `commit-tree <原 tree> -p <新父提交>`，`target` 用新说明，其余用原说明。不可能冲突，不碰暂存区与工作区。
 * 最后 `update-ref HEAD <新> <旧>` 移过去（HEAD 是分支时移的是分支）：带上旧值，读完之后 HEAD 被别人动过就失败。
 *
 * 作者与作者时间（含时区）原样搬过去，提交者与提交时间是现在，同 `rebase`。
 * 新说明按 `git commit -F` 的默认规则整理（`stripspace`）。`commit-tree` 不读 `commit.gpgSign`，配了就自己加 `-S`。
 * 改 HEAD、移分支，走本地道。
 */
export const rewordCommit: GitCommand<
  [repository: string, target: string, message: string],
  RewordOutcome
> = {
  lock: LockPolicy.Exclusive,

  execute: async (cli, repository, target, message) => {
    const options = { cwd: repository };
    const chain = parseChain((await runRaw(cli, chainArgs(target), options)).stdout).reverse();
    const oldest = chain[0];
    const head = chain.at(-1);
    if (
      oldest === undefined ||
      head === undefined ||
      oldest.hash !== target ||
      chain.some((commit) => commit.parents.length > 1)
    ) {
      return RewordOutcome.NotLinear;
    }

    // 没配时 `config --get` 以 1 退出，不是失败。
    const sign = await cli.exec(["config", "--bool", "--get", "commit.gpgSign"], options);
    const signArgs = sign.stdout.trim() === "true" ? ["-S"] : [];
    const cleaned = (await run(cli, ["stripspace"], { ...options, input: message })).stdout;

    let parent = oldest.parents[0];
    let newHead = "";
    for (const commit of chain) {
      const object = parseCommitObject(
        (await runRaw(cli, commitObjectArgs(commit.hash), options)).stdout,
      );
      const { stdout } = await run(
        cli,
        ["commit-tree", ...signArgs, object.tree, ...(parent === undefined ? [] : ["-p", parent])],
        {
          ...options,
          input: commit.hash === target ? cleaned : object.message,
          env: {
            GIT_AUTHOR_NAME: object.author.name,
            GIT_AUTHOR_EMAIL: object.author.email,
            GIT_AUTHOR_DATE: object.author.date,
          },
        },
      );
      newHead = stdout.trim();
      parent = newHead;
    }
    await run(cli, ["update-ref", "-m", "reword", "HEAD", newHead, head.hash], options);
    return RewordOutcome.Reworded;
  },
};
