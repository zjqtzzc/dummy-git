import { GitDomain } from "@dummy-git/shared";
import { describe, expect, it } from "vitest";
import { HiddenBuffer } from "../hiddenBuffer.js";

describe("HiddenBuffer：隐藏期间的广播攒着，重新可见时一次发出", () => {
  it("可见时原样交回", () => {
    expect(new HiddenBuffer(true).changed([GitDomain.Refs])).toEqual([GitDomain.Refs]);
  });

  it("隐藏时攒下、去重，重新可见时一次交回，之后清空", () => {
    const buffer = new HiddenBuffer(true);
    expect(buffer.setVisible(false)).toEqual([]);
    expect(buffer.changed([GitDomain.Refs])).toEqual([]);
    expect(buffer.changed([GitDomain.Refs, GitDomain.Worktree])).toEqual([]);
    expect(buffer.setVisible(true)).toEqual([GitDomain.Refs, GitDomain.Worktree]);
    expect(buffer.setVisible(true)).toEqual([]);
  });

  it("隐藏期间没变化：重新可见时什么都不发", () => {
    const buffer = new HiddenBuffer(false);
    expect(buffer.setVisible(true)).toEqual([]);
  });
});
