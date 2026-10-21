import { describe, expect, it } from "vitest";
import { clickPopupItem, PopupClick, type PopupItem, PopupItemKind } from "../popupMenu.js";

describe("clickPopupItem", () => {
  it("普通项：执行，整串收起；置灰的不执行、不收起", () => {
    let runs = 0;
    const item = (disabled: boolean): PopupItem => ({
      kind: PopupItemKind.Action,
      label: "Do",
      disabled,
      run: () => {
        runs += 1;
      },
    });
    expect(clickPopupItem(item(false))).toBe(PopupClick.Close);
    expect(runs).toBe(1);
    expect(clickPopupItem(item(true))).toBe(PopupClick.Stay);
    expect(runs).toBe(1);
  });

  it("勾选项：切成相反的状态，选单留着；置灰的不切换", () => {
    const toggled: boolean[] = [];
    const item = (checked: boolean, disabled = false): PopupItem => ({
      kind: PopupItemKind.Toggle,
      label: "Merge Commits",
      checked,
      disabled,
      toggle: (on) => toggled.push(on),
    });
    expect(clickPopupItem(item(true))).toBe(PopupClick.Stay);
    expect(clickPopupItem(item(false))).toBe(PopupClick.Stay);
    expect(clickPopupItem(item(false, true))).toBe(PopupClick.Stay);
    expect(toggled).toEqual([false, true]);
  });

  it("二级选单项、分隔线：什么都不做，选单留着", () => {
    expect(clickPopupItem({ kind: PopupItemKind.Submenu, label: "More", items: [] })).toBe(
      PopupClick.Stay,
    );
    expect(clickPopupItem({ kind: PopupItemKind.Separator, label: "Highlight" })).toBe(
      PopupClick.Stay,
    );
  });
});
