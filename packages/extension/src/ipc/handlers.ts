import { ChangeKind, type DiffOpenMode, type DiffSide } from "@dummy-git/shared";
import type { Repository } from "../core/repository.js";
import {
  commit,
  getCommitDetails,
  getCommitFiles,
  getHead,
  getRefs,
  getSkeleton,
  getStatus,
} from "../git/commands/index.js";
import { defineHandlers, type HandlerMap } from "./router.js";

/**
 * 协议表的另一半：每条命令**怎么执行**。
 *
 * ## 这里是「装配点」，不是「业务逻辑」
 *
 * 每个 handler 都只做一件事：把协议参数转成 `repository.run(命令, 参数…)`。
 * 真正的实现在 M5 的命令层，这里不重复任何知识。
 *
 * 一次性给全（`defineHandlers`），不是逐条注册——**逐条注册正是旧仓库漂移的成因**：
 * 89 次 `.handle()` 散落在 1720 行里，没有任何一处能看出「表里每条都注册了吗」。
 * 这张表从上到下读一遍就是本扩展的全部对外表面积。
 *
 * ## 为什么不 import `vscode`
 *
 * 它只需要一个 `Repository`。不碰 vscode 就意味着这张表能在纯 node 下跑通，
 * 于是「协议接得对不对」有测试守着，而不是只能靠 F5 看一眼。
 *
 * ## `repo` 参数
 *
 * 协议里除 `getRepositories` 外每条都带 `repo`，但第一版只有一个仓库，
 * 所以这里直接用 `repository.location.root`，**不拿协议传来的值去找仓库**——
 * 那个值是 webview 从 `getRepositories` 拿回去再传回来的，必然相同；
 * 用它去选仓库等于凭外部输入决定操作哪个仓库，而现在根本没有「选」这回事。
 * 多仓库时这里换成「按 `params.repo` 查表」，改动只在这一个文件。
 */
/**
 * 要用到 VS Code 界面的动作，由 `extension.ts` 注入。handler 自己不 import vscode，
 * 这样 handler 的测试能在纯 node 下跑。
 */
export interface HandlerUi {
  readonly openDiff: (
    root: string,
    left: DiffSide,
    right: DiffSide,
    mode: DiffOpenMode,
  ) => Promise<void>;
}

export function createHandlers(repository: Repository, ui: HandlerUi): HandlerMap {
  return defineHandlers({
    // 第一版只有一个仓库。多仓库时这里返回多条，面板与协议都不用改。
    getRepositories: () => Promise.resolve([repository.location.root]),
    getSkeleton: () => repository.run(getSkeleton, repository.location.root),
    getCommitDetails: ({ hashes }) =>
      repository.run(getCommitDetails, repository.location.root, hashes),
    getRefs: async () => {
      const root = repository.location.root;
      const [head, refs] = await Promise.all([
        repository.run(getHead, root),
        repository.run(getRefs, root),
      ]);
      return [head, ...refs];
    },
    openDiff: async ({ left, right, mode }) => {
      await ui.openDiff(repository.location.root, left, right, mode);
      return null;
    },
    getCommitFiles: ({ hash }) => repository.run(getCommitFiles, repository.location.root, hash),
    getStatus: () => repository.run(getStatus, repository.location.root),
    commit: async ({ message, paths }) => {
      const root = repository.location.root;
      const { changes } = await repository.run(getStatus, root);
      const untracked = new Set<string>();
      /** 改名：新路径 → 旧路径。界面上只有新路径一行，提交时旧路径的删除要一起带上。 */
      const renamedFrom = new Map<string, string>();
      for (const change of changes) {
        if (change.kind === ChangeKind.Untracked) untracked.add(change.path);
        if (change.kind === ChangeKind.Tracked && change.oldPath !== undefined) {
          renamedFrom.set(change.path, change.oldPath);
        }
      }
      const withOldPaths = paths.flatMap((path) => {
        const old = renamedFrom.get(path);
        return old === undefined ? [path] : [path, old];
      });
      await repository.run(
        commit,
        root,
        message,
        withOldPaths,
        paths.filter((path) => untracked.has(path)),
      );
      return null;
    },
  });
}
