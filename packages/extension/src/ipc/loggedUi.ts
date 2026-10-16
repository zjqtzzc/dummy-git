import { briefString } from "./brief.js";
import type { HandlerUi } from "./handlers.js";
import { type Log, tagged } from "./operation.js";

/**
 * 给 `HandlerUi` 套一层：问了用户什么、用户怎么答的、状态栏说了什么，都记进日志（`CLAUDE.md` G）。
 * 套在出口上，handler 不用改；记的行带所在操作的编号。
 *
 * 打开 diff、合并编辑器、对话框不记：操作开头那行已经写了命令，它们只是那条命令的直接结果。
 */
export function loggedUi(ui: HandlerUi, log: Log): HandlerUi {
  const note = (line: string): void => log.info(tagged(line));
  const quote = (text: string): string => `「${briefString(text)}」`;
  const answer = (actions: readonly string[], index: number | undefined, none: string): string =>
    index === undefined ? none : (actions[index] ?? String(index));

  return {
    ...ui,
    confirm: async (message, action) => {
      const sure = await ui.confirm(message, action);
      note(`确认${quote(message)} → ${sure ? action : "取消"}`);
      return sure;
    },
    confirmRollback: async (paths) => {
      const sure = await ui.confirmRollback(paths);
      note(`确认 Rollback ${paths.length} 个文件 → ${sure ? "Rollback" : "取消"}`);
      return sure;
    },
    choose: async (message, actions, detail) => {
      const index = await ui.choose(message, actions, detail);
      note(`选择${quote(message)} → ${answer(actions, index, "取消")}`);
      return index;
    },
    pick: async (title, items) => {
      const index = await ui.pick(title, items);
      const labels = items.map((item) => item.label);
      note(`选择${quote(title)} → ${answer(labels, index, "取消")}`);
      return index;
    },
    notifyChoice: async (message, actions) => {
      const index = await ui.notifyChoice(message, actions);
      note(`通知${quote(message)} → ${answer(actions, index, "关掉")}`);
      return index;
    },
    askBranchName: async (title, value, validate) => {
      const name = await ui.askBranchName(title, value, validate);
      note(`输入${quote(title)} → ${name === undefined ? "取消" : JSON.stringify(name)}`);
      return name;
    },
    notify: (message) => {
      note(`状态栏${quote(message)}`);
      ui.notify(message);
    },
    withProgress: (title, task, done) =>
      ui.withProgress(title, task, (value) => {
        const said = done(value);
        note(`完成${quote(said)}`);
        return said;
      }),
    copyText: async (text) => {
      await ui.copyText(text);
      note(`复制${quote(text)}`);
    },
  };
}
