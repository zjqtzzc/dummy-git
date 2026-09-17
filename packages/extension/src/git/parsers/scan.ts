/**
 * 字节层的切分工具。三个 parser 共用。
 *
 * 这一层**不认识 git 的任何输出格式**——它只知道「在字节里找分隔符」。
 * 格式知识（记录分隔符是什么、git 会在每条记录后加换行）属于各个 parser。
 *
 * ## 为什么在字节层切，而不是先解码成字符串再 split
 *
 * 1. **不会拖住大缓冲区。** V8 的 `String.split()` 返回的是 sliced string——
 *    内部只是「原始大字符串的偏移量 + 长度」，不复制内容。只要有一个子串还活着，
 *    那个几十 MB 的原串就回收不掉。实测（40 MB 输入，只保留 200 个字段共 12.6 KB）：
 *    整体解码后 split 占用 25 MB，按字节逐字段解码占用 0 MB。
 *    `Buffer.toString()` 每次产出独立的新字符串，没有父串可拖。
 * 2. **不会切坏多字节字符。** UTF-8 里多字节序列的**每个**字节都 ≥ 0x80，
 *    而分隔符（`\0` `\x01` `\n`）全都 < 0x80，所以按字节找分隔符永远不可能
 *    落在一个汉字中间。这是 UTF-8 的自同步性质。
 *
 * ## 为什么交出 `Range` 而不是 `Buffer` 切片
 *
 * `buf.subarray()` 与原 Buffer **共享内存**——把它存进返回值，就等于拖住整个缓冲区，
 * 是上面那个 sliced string 陷阱换了个马甲。`Range` 只是两个数字。
 * 所有字段一律经 `decode()` 产出，于是「subarray 漏进返回值」在结构上不会发生。
 */

/** 缓冲区里的一段，左闭右开。 */
export interface Range {
  readonly start: number;
  readonly end: number;
}

/**
 * 按分隔符把 `[from, to)` 切成若干段。
 *
 * - `sep` 是单个字节值，或一段字节序列。
 * - 分隔符本身不包含在结果里。
 * - **语义与 JS 的 `String.split` 完全一致：永远返回「分隔符个数 + 1」段。**
 *   空段一律保留，包括末尾的：`a|b|` 是三段，最后一段为空。
 *
 * 曾经试过「丢弃末尾空段」（想法是 `a|b|` 结尾那个分隔符不代表还有第三段），
 * **那是错的**：`git log` 的最后一个字段是提交消息，消息为空时记录就以分隔符结尾，
 * 丢掉末尾空段会让字段数从 9 变成 8，消息字段被整个吞掉。
 * 该丢的由调用方按自己的格式决定，这一层不猜。
 */
export function split(buf: Buffer, sep: Buffer | number, from = 0, to = buf.length): Range[] {
  const ranges: Range[] = [];
  const sepLength = typeof sep === "number" ? 1 : sep.length;
  let start = from;

  while (start <= to) {
    const hit = buf.indexOf(sep, start);
    // indexOf 不认识 `to`，越过右界的命中要当作没找到。
    const end = hit === -1 || hit + sepLength > to ? to : hit;
    ranges.push({ start, end });
    // 没找到分隔符，说明这是最后一段。
    if (end === to) break;
    start = end + sepLength;
  }

  return ranges;
}

/** 把一段解码成 UTF-8 字符串。所有字段都必须经由这里产出，见文件头。 */
export function decode(buf: Buffer, range: Range): string {
  return buf.toString("utf8", range.start, range.end);
}
