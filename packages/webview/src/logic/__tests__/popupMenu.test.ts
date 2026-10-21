import { describe, expect, it } from "vitest";
import {
  clickPopupItem,
  openLevels,
  PopupClick,
  type PopupItem,
  PopupItemKind,
  pathAfterClick,
  planHover,
  SUBMENU_CLOSE_DELAY,
  SUBMENU_OPEN_DELAY,
} from "../popupMenu.js";

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

describe("二级选单：开着哪一串", () => {
  const action: PopupItem = { kind: PopupItemKind.Action, label: "Do", run: () => undefined };
  const submenu = (items: readonly PopupItem[] = [action], disabled = false): PopupItem => ({
    kind: PopupItemKind.Submenu,
    label: "More",
    disabled,
    items,
  });

  it("停在二级选单项上：250 ms 后打开它", () => {
    expect(planHover([], 0, 2, submenu())).toEqual({ path: [2], delay: SUBMENU_OPEN_DELAY });
  });

  it("停在同一级别的普通项上：750 ms 后关掉下面开着的", () => {
    expect(planHover([2, 0], 0, 1, action)).toEqual({ path: [], delay: SUBMENU_CLOSE_DELAY });
    expect(planHover([2, 0], 1, 3, action)).toEqual({ path: [2], delay: SUBMENU_CLOSE_DELAY });
  });

  it("停在同一级别的另一个二级选单项上：250 ms 后换成它", () => {
    expect(planHover([2], 0, 4, submenu())).toEqual({ path: [4], delay: SUBMENU_OPEN_DELAY });
  });

  it("停在已经开着的那一项、或停在没东西开着的普通项上：不用改", () => {
    expect(planHover([2], 0, 2, submenu())).toBeUndefined();
    expect(planHover([], 0, 1, action)).toBeUndefined();
    expect(planHover([2], 1, 0, action)).toBeUndefined();
  });

  it("置灰的二级选单项：停上去、点它都不打开", () => {
    expect(planHover([], 0, 2, submenu([action], true))).toBeUndefined();
    expect(pathAfterClick([], 0, 2, submenu([action], true))).toEqual([]);
  });

  it("点二级选单项：立刻打开；点普通项：不变", () => {
    expect(pathAfterClick([2, 0], 0, 4, submenu())).toEqual([4]);
    expect(pathAfterClick([2], 1, 0, action)).toEqual([2]);
  });

  it("每一级显示的选单项：顺着开着的那一串往下；走不通就停", () => {
    const inner = [action];
    const outer = [action, submenu(inner)];
    expect(openLevels(outer, [1])).toEqual([outer, inner]);
    expect(openLevels(outer, [])).toEqual([outer]);
    expect(openLevels(outer, [0])).toEqual([outer]);
  });
});
