import { describe, expect, it } from "vitest";
import { MessageUpdate, messageUpdate } from "../operationMessage.js";

const HASH = "a".repeat(40);

describe("messageUpdate", () => {
  it("还没读过、也没有停着的操作：留着原来的草稿", () => {
    expect(messageUpdate(undefined, null)).toBe(MessageUpdate.Keep);
  });

  it("第一次读到一停：用 git 准备的说明", () => {
    expect(messageUpdate(undefined, HASH)).toBe(MessageUpdate.Fill);
  });

  it("同一停再刷新：不盖掉框里的字", () => {
    expect(messageUpdate(HASH, HASH)).toBe(MessageUpdate.Keep);
  });

  it("换到下一停：重新填", () => {
    expect(messageUpdate(HASH, `${"b".repeat(40)}`)).toBe(MessageUpdate.Fill);
  });

  it("停结束了：清空", () => {
    expect(messageUpdate(HASH, null)).toBe(MessageUpdate.Clear);
  });

  it("本来就没有操作：不清空", () => {
    expect(messageUpdate(null, null)).toBe(MessageUpdate.Keep);
  });
});
