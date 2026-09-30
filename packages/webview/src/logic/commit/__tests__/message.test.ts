import { describe, expect, it } from "vitest";
import { commitMessage, isBlankMessage } from "../message.js";

describe("commitMessage：只去首尾空行", () => {
  it("首尾的空行（含只有空白的行）去掉", () => {
    expect(commitMessage("\n  \nfix: a\n\n")).toBe("fix: a");
  });

  it("中间的空行与行内空白原样保留", () => {
    expect(commitMessage("title\n\n  body line  ")).toBe("title\n\n  body line  ");
  });
});

describe("isBlankMessage", () => {
  it("只有空白也算空", () => {
    expect(isBlankMessage(" \n\t")).toBe(true);
    expect(isBlankMessage("x")).toBe(false);
  });
});
