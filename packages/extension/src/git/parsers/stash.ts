/**
 * stash 列表的命令与解析。
 *
 * 字段之间、记录之间都是 NUL（`-z` 让记录以 NUL 分隔）。说明在最后一个字段，
 * 不会含 NUL，所以按「每 4 个字段一条」切就不会错位。
 */
import type { Stash } from "@dummy-git/shared";
import { GitParseError } from "./errors.js";
import { decode, split } from "./scan.js";

const NUL = 0x00;

const HASH = 0;
const PARENTS = 1;
const TIME = 2;
const MESSAGE = 3;
const FIELD_COUNT = 4;

/** `%P` 是空格分隔的父提交：存时所在的提交、暂存区那条、（存了未跟踪文件时）未跟踪那条。 */
const STASH_FORMAT = "%H%x00%P%x00%ct%x00%gs";

/** 最新的在最前。没有 stash 时什么都不输出，不报错。 */
export function stashListArgs(): string[] {
  return ["stash", "list", "-z", `--format=${STASH_FORMAT}`];
}

export function parseStashList(stdout: Buffer): Stash[] {
  const fields = split(stdout, NUL).map((range) => decode(stdout, range));
  // 末尾可能有一个结束用的 NUL，切出一个空字段。
  if (fields.at(-1) === "") fields.pop();
  if (fields.length % FIELD_COUNT !== 0) {
    throw new GitParseError({
      parser: "parseStashList",
      recordIndex: -1,
      detail: `字段数 ${fields.length} 不是 ${FIELD_COUNT} 的整数倍`,
      buf: stdout,
      range: { start: 0, end: stdout.length },
    });
  }
  const stashes: Stash[] = [];
  for (let i = 0; i < fields.length; i += FIELD_COUNT) {
    const [base = "", , untracked] = (fields[i + PARENTS] ?? "").split(" ");
    const stash = {
      hash: fields[i + HASH] ?? "",
      base,
      message: fields[i + MESSAGE] ?? "",
      at: Number(fields[i + TIME]),
    };
    // exactOptionalPropertyTypes：没存未跟踪文件时该字段必须不存在。
    stashes.push(untracked === undefined ? stash : { ...stash, untracked });
  }
  return stashes;
}
