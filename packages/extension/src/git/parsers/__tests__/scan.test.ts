import { describe, expect, it } from "vitest";
import { decode, split } from "../scan.js";

/** 把 `split` 的结果解码回字符串，方便和 `String.split` 直接比。 */
function parts(input: string, sep: string): string[] {
  const buf = Buffer.from(input, "utf8");
  return split(buf, Buffer.from(sep, "utf8")).map((r) => decode(buf, r));
}

describe("split：语义与 String.split 一致", () => {
  // 逐条对齐，而不是自己定义一套语义——一旦两者分叉，
  // 调用方按直觉写出来的代码就会错，而且错得很安静。
  const cases = ["a|b|c", "a|b|", "|a|b", "a||b", "", "|", "||", "abc", "|||a"];

  for (const input of cases) {
    it(`${JSON.stringify(input)}`, () => {
      expect(parts(input, "|")).toEqual(input.split("|"));
    });
  }
});

describe("split：末尾空段不能丢", () => {
  /**
   * log 的记录形如 `f1\0f2\0...\0%B\0`，`%B` 是最后一个字段。
   * 提交消息为空时记录以分隔符结尾，丢掉末尾空段会让字段数从 9 变成 8——
   * 于是消息字段被吞掉，最后一个字段变成提交时间戳。
   *
   * **这个 bug 只有特意去试空消息才会现形。**
   */
  it("空消息：字段数不能少一个", () => {
    const record = "hash\0parent\0author\0";
    expect(parts(record, "\0")).toEqual(["hash", "parent", "author", ""]);
    expect(parts(record, "\0")).toHaveLength(4);
  });
});

describe("split：多字节字符不被切坏", () => {
  /**
   * UTF-8 的自同步性质：多字节序列的**每个**字节都 ≥ 0x80，
   * 而分隔符（`\0` `\x01` `\n`）全都 < 0x80，
   * 所以按字节找分隔符永远不可能落在一个汉字中间。
   */
  it("中文字段", () => {
    expect(parts("你好\0世界\0", "\0")).toEqual(["你好", "世界", ""]);
  });

  it("emoji（四字节）", () => {
    expect(parts("🌍\0🚀\0", "\0")).toEqual(["🌍", "🚀", ""]);
  });

  it("多字节字符内部不含分隔符字节", () => {
    const buf = Buffer.from("你好世界", "utf8");
    expect(buf.every((b) => b >= 0x80)).toBe(true);
  });
});

describe("split：多字节分隔符", () => {
  it("NUL NUL SOH 作记录分隔符", () => {
    const sep = "\0\0\x01";
    expect(parts(`a${sep}b${sep}`, sep)).toEqual(["a", "b", ""]);
  });

  it("单独的 SOH 不构成分隔符", () => {
    // fixture 里那条「奇异消息」提交就是为这条存在的：
    // `\x01` 单独出现是合法的提交消息内容。
    const sep = "\0\0\x01";
    expect(parts(`a\x01b${sep}`, sep)).toEqual(["a\x01b", ""]);
  });
});

describe("split：子区间 [from, to) 是硬边界", () => {
  /**
   * 守的是 `split` 里的右界保护（`hit + sepLength > to ? to : hit`）。
   *
   * `buf.indexOf()` 不认识 `to`，会一路搜到缓冲区末尾。
   * 少了那道保护，**子区间之外的分隔符会被当成本段的终点**，
   * 于是这一段越过 `to`、吃进后面的内容。
   *
   * 现在碰巧不可达——log 的记录分隔符 `\0\0\x01` 以字段分隔符 `\0` 开头，
   * 所以命中位置总是恰好等于 `to`，有没有保护结果都一样，别的测试都守不住它。
   * 但那是分隔符选得巧，不是设计保证：换一组分隔符、或新增一个按子区间切的调用方，
   * 立刻就会让相邻记录串数据。
   */
  it("分隔符在 to 之后时，段仍然止于 to", () => {
    const buf = Buffer.from("abcdef\x00xyz", "utf8");
    // [0,3) 内没有分隔符；最近的 \0 在下标 6，已越过右界。
    expect(split(buf, 0x00, 0, 3).map((r) => decode(buf, r))).toEqual(["abc"]);
  });

  it("分隔符恰好落在 to 上时，段止于 to", () => {
    const buf = Buffer.from("abc\x00xyz", "utf8");
    expect(split(buf, 0x00, 0, 3).map((r) => decode(buf, r))).toEqual(["abc"]);
  });

  it("多字节分隔符跨越右界时不算命中", () => {
    // 记录分隔符 \0\0\x01 从下标 3 开始，但 to=4 把它劈开了。
    const buf = Buffer.from("abc\x00\x00\x01def", "utf8");
    const sep = Buffer.from("\x00\x00\x01", "utf8");
    expect(split(buf, sep, 0, 4).map((r) => decode(buf, r))).toEqual(["abc\x00"]);
  });
});

describe("decode：产出独立字符串", () => {
  /**
   * 不能返回 `buf.subarray()`——它与原 Buffer **共享内存**，
   * 存进返回值就等于拖住整个缓冲区（V8 sliced string 陷阱换了个马甲）。
   * `Buffer.toString()` 每次产出全新字符串。
   */
  it("改动原 buffer 不影响已解码的字符串", () => {
    const buf = Buffer.from("hello", "utf8");
    const s = decode(buf, { start: 0, end: 5 });
    buf.fill(0);
    expect(s).toBe("hello");
  });
});
