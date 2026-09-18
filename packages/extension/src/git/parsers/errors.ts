/**
 * 解析失败。
 *
 * **与 M4 的 `git/failure.ts` 不是一回事**：那个是「git 命令失败了」
 * （锁冲突、认证、不是仓库），这个是「git 的输出我看不懂」。
 * 两类错误的处理方式完全不同——前者多半可重试或可提示用户，后者是我们的 bug 或
 * git 换了格式，只能报障。
 *
 * ## 为什么是抛，不是降级
 *
 * 曾考虑过给未知状态码加一个 `Unknown` 变体优雅降级，否决了，理由是它同时违反三条纪律：
 * §C.2（每个调用方永远要处理这个分支 = 防御性检查撒遍代码库）、
 * §B.6（把解析层事故变成数据结构里的合法状态）、
 * §C.1（会静默降级的 validator 不算在验证）。
 *
 * 代价是明确的：一个未知码会让整次解析失败。所以这个错误必须带够信息，
 * 目标是**用户把它贴过来就能复现，不用追问「你当时在干什么」**。
 * 另外上层不许 catch 后当空结果处理——空面板比报错更糟，
 * 用户会以为「没有改动」而不是「工具坏了」。
 */
import type { Range } from "./scan.js";

/** 出错现场最多截取多少字节。够看清格式，又不会把几 MB 的输出灌进日志。 */
const MAX_DUMP_BYTES = 160;

function hexDump(bytes: Buffer): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(" ");
}

/** 把不可见字符显示出来，其余原样——光看十六进制认不出内容，光看文本看不见分隔符。 */
function readable(bytes: Buffer): string {
  return bytes
    .toString("utf8")
    .replaceAll("\0", "␀")
    .replaceAll("\x01", "␁")
    .replaceAll("\n", "␊")
    .replaceAll("\r", "␍")
    .replaceAll("\t", "␉");
}

export class GitParseError extends Error {
  constructor(options: {
    /** 哪个 parser，如 `parseLog`。 */
    readonly parser: string;
    /** 第几条记录（从 0 开始）。整体性错误传 -1。 */
    readonly recordIndex: number;
    /** 哪里不对，如「期望 9 个字段，实际 8 个」。 */
    readonly detail: string;
    readonly buf: Buffer;
    readonly range: Range;
  }) {
    const { parser, recordIndex, detail, buf, range } = options;
    const length = range.end - range.start;
    // 立刻转成有界文本：不能把 Buffer 存进 Error——它与原始缓冲区共享内存，
    // 一个被留存的错误对象就会拖住几十 MB。
    const shown = buf.subarray(range.start, Math.min(range.end, range.start + MAX_DUMP_BYTES));
    const omitted = length > shown.length ? `…（共 ${length} 字节，只显示前 ${shown.length}）` : "";

    super(
      `${parser} 解析失败` +
        (recordIndex >= 0 ? `（第 ${recordIndex} 条记录）` : "") +
        `：${detail}\n` +
        `  原文: ${readable(shown)}${omitted}\n` +
        `  字节: ${hexDump(shown)}${omitted}`,
    );
    this.name = "GitParseError";
  }
}
