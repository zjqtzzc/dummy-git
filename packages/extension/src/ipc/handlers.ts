import { ChangeKind, type DiffOpenMode, type DiffSide } from "@dummy-git/shared";
import type { Repository } from "../core/repository.js";
import {
  amendCommit,
  commit,
  getCommitDetails,
  getCommitFiles,
  getHead,
  getRefs,
  getSkeleton,
  getStatus,
  rollback,
} from "../git/commands/index.js";
import { defineHandlers, type HandlerMap } from "./router.js";

/**
 * 协议表的另一半：每条命令**怎么执行**。
 *
 * ## 这里是「装配点」，不是「业务逻辑」
 *
 * 每个 handler 把协议参数转成 `repository.run(命令, 参数…)`，最多再补一点只有扩展知道的事
 * （按当前 `git status` 分出未跟踪、给改名补旧路径、弹确认框）。真正的实现在命令层。
 *
 * 一次性给全（`defineHandlers`），不是逐条注册：这张表从上到下读一遍就是本扩展的全部对外表面积。
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
  /** Rollback 前的确认：`true` 是确认。只列勾选的已跟踪文件（不含补上的旧路径）。 */
  readonly confirmRollback: (paths: readonly string[]) => Promise<boolean>;
  readonly openDiff: (
    root: string,
    left: DiffSide,
    right: DiffSide,
    mode: DiffOpenMode,
  ) => Promise<void>;
}

export function createHandlers(repository: Repository, ui: HandlerUi): HandlerMap {
  /**
   * 按当前的 `git status` 看勾选的路径：哪些是未跟踪文件（提交前要先 `add`；Rollback 不管），
   * 哪些是已跟踪的；`withOldPaths` 给改名的补上旧路径——界面上只有新路径一行，
   * 旧路径那一半（删除）要一起交给 git，否则剩下一个 D。
   * 由扩展自己问 git，不信 webview 手里可能已过时的状态。
   */
  const inspect = async (paths: readonly string[]) => {
    const { changes } = await repository.run(getStatus, repository.location.root);
    const untracked = new Set<string>();
    const renamedFrom = new Map<string, string>();
    for (const change of changes) {
      if (change.kind === ChangeKind.Untracked) untracked.add(change.path);
      if (change.kind === ChangeKind.Tracked && change.oldPath !== undefined) {
        renamedFrom.set(change.path, change.oldPath);
      }
    }
    return {
      untracked: paths.filter((path) => untracked.has(path)),
      tracked: paths.filter((path) => !untracked.has(path)),
      withOldPaths: (list: readonly string[]): string[] =>
        list.flatMap((path) => {
          const old = renamedFrom.get(path);
          return old === undefined ? [path] : [path, old];
        }),
    };
  };

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
      const { untracked, withOldPaths } = await inspect(paths);
      await repository.run(
        commit,
        repository.location.root,
        message,
        withOldPaths(paths),
        untracked,
      );
      return null;
    },
    amend: async ({ message, paths }) => {
      const { untracked, withOldPaths } = await inspect(paths);
      await repository.run(
        amendCommit,
        repository.location.root,
        message,
        withOldPaths(paths),
        untracked,
      );
      return null;
    },
    rollback: async ({ paths }) => {
      // 未跟踪文件不归 Rollback 管（第 7 阶段右键 Delete）。一个已跟踪的都没有就什么都不做。
      const { tracked, withOldPaths } = await inspect(paths);
      if (tracked.length === 0 || !(await ui.confirmRollback(tracked))) return null;
      await repository.run(rollback, repository.location.root, withOldPaths(tracked));
      return null;
    },
  });
}
