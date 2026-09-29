import { DiffSideKind } from "@dummy-git/shared";
import { describe, expect, it } from "vitest";
import { diffTitle } from "../diffTab.js";

describe("diffTitle", () => {
  it("文件名 + 左右短 hash，不存在的一边写 none", () => {
    const hash = "9c487b97".padEnd(40, "0");
    expect(
      diffTitle(
        { kind: DiffSideKind.Missing, path: "src/a.ts" },
        { kind: DiffSideKind.Revision, hash, path: "src/a.ts" },
      ),
    ).toBe("a.ts (none ↔ 9c487b9)");
  });
});
