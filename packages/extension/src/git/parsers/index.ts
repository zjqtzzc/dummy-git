/**
 * parser 层的对外出口。
 *
 * `scan.ts` 不在这里导出——它是内部工具，只给同目录的 parser 用。
 * 命令层不应该拿到字节切分原语，那会诱使它自己去解析。
 */
export { GitParseError } from "./errors.js";
export {
  detailsArgs,
  matchArgs,
  parseHashes,
  parseLog,
  parseSkeleton,
  type StdinCommand,
  skeletonArgs,
} from "./log.js";
export { headArgs, parseHead, parseRefs, refsArgs } from "./refs.js";
export { parseStashList, stashListArgs } from "./stash.js";
export { parseStatus, STATUS_ENV, statusArgs } from "./status.js";
