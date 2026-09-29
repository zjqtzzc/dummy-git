import { describe, expect, it } from "vitest";
import setiMap from "../../seti/setiMap.json";
import { setiIcon } from "../setiIcon.js";

const def = (id: string) => setiMap.defs[id as keyof typeof setiMap.defs];

describe("setiIcon：按文件名查图标", () => {
  it("按扩展名：.ts → TypeScript 图标", () => {
    expect(setiIcon("a.ts", false)).toEqual(def("_typescript"));
  });

  it("不区分大小写", () => {
    expect(setiIcon("A.TS", false)).toEqual(setiIcon("a.ts", false));
  });

  it("多段扩展名从长到短试：精确的长扩展名优先", () => {
    // 找一个映射表里真实存在的两段扩展名来验，不写死具体条目。
    const twoPart = Object.keys(setiMap.dark.fileExtensions).find((ext) => ext.includes("."));
    expect(twoPart).toBeDefined();
    const id = setiMap.dark.fileExtensions[twoPart as keyof typeof setiMap.dark.fileExtensions];
    expect(setiIcon(`x.${twoPart}`, false)).toEqual(def(id));
  });

  it("精确文件名优先于扩展名", () => {
    const [name, id] = Object.entries(setiMap.dark.fileNames)[0] ?? ["", ""];
    expect(setiIcon(name, false)).toEqual(def(id));
  });

  it("认不出的文件 → 默认图标", () => {
    expect(setiIcon("no-such-extension.zzz", false)).toEqual(def(setiMap.dark.file));
  });

  it("浅色主题用 _light 那一套", () => {
    expect(setiIcon("a.ts", true)).toEqual(def("_typescript_light"));
  });
});
