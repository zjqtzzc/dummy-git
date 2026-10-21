import { GitParseError } from "./errors.js";
import { decode } from "./scan.js";

/** 按仓库的 mailmap 换算一个「名字 <邮箱>」。邮箱为空时写 `名字 <>`，git 照样认。 */
export function mailmapArgs(name: string, email: string): string[] {
  return ["check-mailmap", `${name} <${email}>`];
}

/**
 * `check-mailmap` 的输出（一行 `名字 <邮箱>`）→ 名字与邮箱。没有对应的条目时原样输出。
 * 邮箱里不会有 `<`，所以从最后一个 `<` 拆。
 */
export function parseMailmapContact(stdout: Buffer): { name: string; email: string } {
  const line = decode(stdout, { start: 0, end: stdout.length }).trim();
  const open = line.lastIndexOf("<");
  if (open <= 0 || !line.endsWith(">")) {
    throw new GitParseError({
      parser: "parseMailmapContact",
      recordIndex: -1,
      detail: "不是「名字 <邮箱>」",
      buf: stdout,
      range: { start: 0, end: stdout.length },
    });
  }
  return { name: line.slice(0, open).trim(), email: line.slice(open + 1, -1) };
}
