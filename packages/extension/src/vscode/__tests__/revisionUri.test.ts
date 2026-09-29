import { type DiffSide, DiffSideKind } from "@dummy-git/shared";
import { describe, expect, it } from "vitest";
import { parseRevisionUri, toRevisionUri } from "../revisionUri.js";

const HASH = "9c487b97".padEnd(40, "0");

describe("revisionUri：一边 ↔ URI", () => {
  it.each<[string, DiffSide]>([
    ["某个提交里的文件", { kind: DiffSideKind.Revision, hash: HASH, path: "src/a.ts" }],
    ["不存在", { kind: DiffSideKind.Missing, path: "src/a.ts" }],
    ["中文与空格路径", { kind: DiffSideKind.Revision, hash: HASH, path: "文档/说 明.md" }],
  ])("%s：拼出来再解析回去，得到原样", (_name, side) => {
    const { fsPath, query } = toRevisionUri("/repo", side);
    expect(parseRevisionUri("/repo", fsPath, query)).toEqual(side);
  });

  it("格式本身：路径是绝对路径，查询部分是 rev=<hash> 或 empty", () => {
    expect(
      toRevisionUri("/repo", { kind: DiffSideKind.Revision, hash: HASH, path: "a/b.ts" }),
    ).toEqual({
      fsPath: "/repo/a/b.ts",
      query: `rev=${HASH}`,
    });
    expect(toRevisionUri("/repo", { kind: DiffSideKind.Missing, path: "b.ts" }).query).toBe(
      "empty",
    );
  });

  it.each([
    ["缩写 hash", `rev=9c487b9`],
    ["表达式", "rev=HEAD^"],
    ["不认识的查询", "ref=main"],
    ["空查询", ""],
  ])("认不出的查询 → undefined，不猜（%s）", (_name, query) => {
    expect(parseRevisionUri("/repo", "/repo/a.ts", query)).toBeUndefined();
  });

  it("路径不在仓库根下 → undefined", () => {
    expect(parseRevisionUri("/repo", "/other/a.ts", `rev=${HASH}`)).toBeUndefined();
  });
});
