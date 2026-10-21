import { describe, expect, it } from "vitest";
import { PopupSide, placePopup } from "../popupPlacement.js";

/** webview 400×300；按钮 22×22。 */
const viewport = { width: 400, height: 300 };
const button = (left: number, top: number) => ({ left, top, width: 22, height: 22 });
const menu = { width: 150, height: 100 };

describe("一级选单（按钮下方）", () => {
  it("放得下：按钮正下方，左边对齐，留 2px", () => {
    expect(placePopup(button(10, 10), PopupSide.Below, menu, viewport)).toEqual({
      left: 10,
      top: 34,
    });
  });

  it("下面放不下、上面放得下：翻到按钮上方", () => {
    expect(placePopup(button(10, 250), PopupSide.Below, menu, viewport)).toEqual({
      left: 10,
      top: 148,
    });
  });

  it("右边超出：改成右边和按钮右边对齐；按钮露出左边缘：贴到 0", () => {
    expect(placePopup(button(380, 10), PopupSide.Below, menu, viewport).left).toBe(252);
    expect(placePopup(button(-5, 10), PopupSide.Below, menu, viewport).left).toBe(0);
  });

  it("左右都放不下（比 webview 还宽、或右对齐也越过左边）：贴着右边缘，不小于 0", () => {
    expect(
      placePopup(button(100, 10), PopupSide.Below, { width: 380, height: 100 }, viewport).left,
    ).toBe(20);
    expect(
      placePopup(button(100, 10), PopupSide.Below, { width: 500, height: 100 }, viewport).left,
    ).toBe(0);
  });

  it("上下都放不下：放在空间大的那边并限高", () => {
    const tall = { width: 150, height: 280 };
    // 按钮靠上：下面 300-(42+2)=256，上面 20-2=18
    expect(placePopup(button(10, 20), PopupSide.Below, tall, viewport)).toEqual({
      left: 10,
      top: 44,
      maxHeight: 256,
    });
    // 按钮靠下：下面 300-(262+2)=36，上面 240-2=238
    expect(placePopup(button(10, 240), PopupSide.Below, tall, viewport)).toEqual({
      left: 10,
      top: 0,
      maxHeight: 238,
    });
  });
});

describe("二级选单（父项右边）", () => {
  /** 父项：父选单里的一行，和父选单一样宽。 */
  const item = (left: number, top: number) => ({ left, top, width: 150, height: 22 });

  it("放得下：父项右边，顶部对齐，不留空隙", () => {
    expect(placePopup(item(10, 50), PopupSide.Right, menu, viewport)).toEqual({
      left: 160,
      top: 50,
    });
  });

  it("右边放不下：翻到父选单左边", () => {
    expect(placePopup(item(200, 50), PopupSide.Right, menu, viewport).left).toBe(50);
  });

  it("左右都放不下：不压窄，挪进可见范围（盖住父选单一部分）", () => {
    expect(
      placePopup(item(100, 50), PopupSide.Right, { width: 200, height: 100 }, viewport).left,
    ).toBe(200);
  });

  it("下面超出：往上挪；比整个高度还高：从顶上开始并限高", () => {
    expect(placePopup(item(10, 250), PopupSide.Right, menu, viewport).top).toBe(200);
    expect(
      placePopup(item(10, 50), PopupSide.Right, { width: 150, height: 500 }, viewport),
    ).toEqual({
      left: 160,
      top: 0,
      maxHeight: 300,
    });
  });
});
