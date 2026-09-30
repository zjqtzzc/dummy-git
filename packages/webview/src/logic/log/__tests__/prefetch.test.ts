import { describe, expect, it } from "vitest";
import { hashesToFetch } from "../prefetch.js";

const HASHES = Array.from({ length: 200 }, (_, i) => `h${i}`);

describe("hashesToFetch：可见范围前后各多取 20 行，不重复要", () => {
  it("中间一屏：前后各扩 20 行", () => {
    const wanted = hashesToFetch(HASHES, { start: 100, end: 120 }, new Set());
    expect(wanted[0]).toBe("h80");
    expect(wanted.at(-1)).toBe("h139");
    expect(wanted).toHaveLength(60);
  });

  it("已经取到或正在路上的跳过", () => {
    const known = new Set(["h80", "h81"]);
    expect(hashesToFetch(HASHES, { start: 100, end: 120 }, known)).not.toContain("h80");
  });

  it("两端夹在列表范围里", () => {
    expect(hashesToFetch(HASHES, { start: 0, end: 10 }, new Set())).toHaveLength(30);
    expect(hashesToFetch(HASHES, { start: 190, end: 200 }, new Set())).toHaveLength(30);
  });

  it("全都知道了 → 空，不发请求", () => {
    expect(hashesToFetch(HASHES, { start: 0, end: 10 }, new Set(HASHES))).toEqual([]);
  });
});
