/**
 * 在内存里改写提交要读的两样东西：一段第一父提交链，与单条提交对象的原文。
 *
 * 命令行与解析放在一起，理由同 `log.ts`：输出长什么样由命令行决定。
 */
import { GitParseError } from "./errors.js";

/** 一条提交：hash 与它的全部父提交（`rev-list --parents` 的一行）。 */
export interface ChainCommit {
  readonly hash: string;
  readonly parents: readonly string[];
}

/**
 * 从 HEAD 沿第一父提交往回走到 `target`（含）：`rev-list --first-parent --parents HEAD --not <target>^@`。
 * `<target>^@` 是它的全部父提交，排除掉它们，走到 `target` 就停。根提交没有父提交，`^@` 什么都不排除。
 * 最新的在前。`target` 不在这条链上时，最后一条不是它（调用方查）。
 */
export function chainArgs(target: string): string[] {
  return ["rev-list", "--first-parent", "--parents", "HEAD", "--not", `${target}^@`];
}

export function parseChain(stdout: Buffer): ChainCommit[] {
  return stdout
    .toString("utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const [hash = "", ...parents] = line.split(" ");
      return { hash, parents };
    });
}

/** 作者：原样搬到新提交上（`GIT_AUTHOR_*`）。 */
interface Author {
  readonly name: string;
  readonly email: string;
  /** git 的原始格式 `<unix 秒> <时区>`，如 `1700000000 +0800`，时区原样保留。 */
  readonly date: string;
}

/** 重造一条提交要的：内容、作者、说明。父提交由调用方给（新的）。 */
export interface CommitObject {
  readonly tree: string;
  readonly author: Author;
  /** 原文，一个字节不改（含结尾的换行）。 */
  readonly message: string;
}

/** 一条提交对象的原文：`cat-file commit <hash>`。 */
export function commitObjectArgs(hash: string): string[] {
  return ["cat-file", "commit", hash];
}

const AUTHOR = /^author (.*) <(.*)> (\d+ [+-]\d{4})$/;

/**
 * 提交对象 = 头部若干行（`tree`、`parent`、`author`、`committer`，可能还有签名等多行头）+ 空行 + 说明。
 * 只取 `tree` 与 `author`；续行以空格开头，不会被当成 `tree` / `author`。
 */
export function parseCommitObject(stdout: Buffer): CommitObject {
  const fail = (detail: string): GitParseError =>
    new GitParseError({
      parser: "parseCommitObject",
      recordIndex: -1,
      detail,
      buf: stdout,
      range: { start: 0, end: stdout.length },
    });
  const split = stdout.indexOf("\n\n");
  if (split === -1) throw fail("没有头部与说明之间的空行");
  const headers = stdout.subarray(0, split).toString("utf8").split("\n");
  const tree = headers.find((line) => line.startsWith("tree "))?.slice("tree ".length);
  const author = headers.map((line) => AUTHOR.exec(line)).find((match) => match !== null);
  if (tree === undefined) throw fail("没有 tree");
  if (author === undefined) throw fail("没有 author");
  const [, name = "", email = "", date = ""] = author;
  return {
    tree,
    author: { name, email, date },
    message: stdout.subarray(split + 2).toString("utf8"),
  };
}
