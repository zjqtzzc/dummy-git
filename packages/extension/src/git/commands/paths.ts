import { runRaw } from "../failure.js";
import type { GitCommand } from "./command.js";
import { LockPolicy } from "./lock.js";

/** 被跟踪的目录或文件（Paths 按钮的列表）。 */
export interface TrackedPath {
  /** 相对仓库根、`/` 分隔；目录不带结尾的 `/`。 */
  readonly path: string;
  readonly folder: boolean;
}

/**
 * 被跟踪的文件与由它们推出的目录，按路径排序（目录排在它下面的东西前面）：`git ls-files -z`。
 * 只有现在还在的；改名前的旧路径、已删除的文件选不到。读命令，不排队。
 */
export const listPaths: GitCommand<[repository: string], TrackedPath[]> = {
  lock: LockPolicy.None,

  execute: async (cli, repository) => {
    const result = await runRaw(cli, ["ls-files", "-z"], { cwd: repository });
    const files = result.stdout
      .toString("utf8")
      .split("\0")
      .filter((path) => path !== "");
    const folders = new Set<string>();
    for (const file of files) {
      for (let slash = file.indexOf("/"); slash !== -1; slash = file.indexOf("/", slash + 1)) {
        folders.add(file.slice(0, slash));
      }
    }
    return [
      ...[...folders].map((path) => ({ path, folder: true })),
      ...files.map((path) => ({ path, folder: false })),
    ].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  },
};
