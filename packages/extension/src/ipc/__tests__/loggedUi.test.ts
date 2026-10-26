import { describe, expect, it } from "vitest";
import type { HandlerUi } from "../handlers.js";
import { loggedUi } from "../loggedUi.js";
import { type Log, Operations } from "../operation.js";

function recorder(): { log: Log; lines: string[] } {
  const lines: string[] = [];
  const at = (line: string) => void lines.push(line);
  return { log: { error: at, warn: at, info: at, debug: at }, lines };
}

/** 用户的回答：确认点「是」、选第二项、输入框取消。 */
const ANSWERING: HandlerUi = {
  confirm: async () => true,
  confirmRollback: async () => false,
  choose: async () => 1,
  pick: async () => undefined,
  notifyChoice: async () => undefined,
  askBranchName: async () => undefined,
  notify: () => undefined,
  withProgress: async (_title, task, done) => {
    const value = await task();
    done(value);
    return value;
  },
  copyText: async () => undefined,
  logWebviewError: () => undefined,
  openDialog: () => undefined,
  closeDialog: () => undefined,
  openDiff: async () => undefined,
  openFile: async () => undefined,
  openMergeEditor: async () => undefined,
};

describe("loggedUi：问答与完成消息进日志，带操作编号", () => {
  it("问了什么、答了什么", async () => {
    const { log, lines } = recorder();
    const ui = loggedUi(ANSWERING, log);
    await new Operations(log).run("m", "dropStash", {}, async () => {
      await ui.confirm('Delete the stash "WIP"?\nThis cannot be undone.', "Delete");
      await ui.confirmRollback(["a", "b"]);
      await ui.choose("Update how?", ["Merge", "Rebase"]);
      await ui.askBranchName("New Branch", "", async () => undefined);
      return null;
    });
    expect(lines.slice(1, -1)).toEqual([
      '#1 确认「Delete the stash "WIP"? …（共 2 行）」 → Delete',
      "#1 确认 Rollback 2 个文件 → 取消",
      "#1 选择「Update how?」 → Rebase",
      "#1 输入「New Branch」 → 取消",
    ]);
  });

  it("完成消息与状态栏", async () => {
    const { log, lines } = recorder();
    const ui = loggedUi(ANSWERING, log);
    await new Operations(log).run("m", "stash", {}, async () => {
      await ui.withProgress(
        "Stashing…",
        async () => "Saved working directory",
        (said) => said,
      );
      ui.notify("Dropped stash@{0} (abc)");
      return null;
    });
    expect(lines.slice(1, -1)).toEqual([
      "#1 完成「Saved working directory」",
      "#1 状态栏「Dropped stash@{0} (abc)」",
    ]);
  });
});
