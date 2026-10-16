import { assertNever, GitErrorCode } from "@dummy-git/shared";
import type { GitCli } from "../git/cli.js";
import { getRepositoryLocation, type RepositoryLocation } from "../git/commands/index.js";
import { GitFailureError } from "../git/failure.js";

/** 扩展启动时，仓库这件事的四种结局。 */
export enum StartupKind {
  /** 找到了至少一个仓库。 */
  Ready = "ready",
  /** 窗口里没有打开任何目录。 */
  NoFolder = "noFolder",
  /** 打开了目录，但没有一个在 git 仓库里。 */
  NoRepository = "noRepository",
  /** git 起不来：没装、路径不对、没有执行权限…… */
  GitUnavailable = "gitUnavailable",
}

export type StartupResult =
  | {
      readonly kind: StartupKind.Ready;
      /**
       * 按工作区目录的顺序，按根目录去重。现阶段只用第一个。
       * 类型写成「至少一个」：走到 `Ready` 就一定有仓库，取第一个不必再判空。
       */
      readonly repositories: readonly [RepositoryLocation, ...RepositoryLocation[]];
    }
  | { readonly kind: StartupKind.NoFolder }
  | { readonly kind: StartupKind.NoRepository }
  | {
      readonly kind: StartupKind.GitUnavailable;
      /** 原始报错，给人排查用。 */
      readonly reason: string;
    };

/**
 * 从工作区目录列表得出仓库列表。
 *
 * ## 为什么参数是「目录列表」而不是 workspace folder
 *
 * 为了这一层能在纯 node 下测。与 VSCode 有关的只有「取出所有 workspace folder 的路径」
 * 那一句，留在 `extension.ts`。
 *
 * ## 逐个目录问，按根去重
 *
 * 同一个仓库可能出现多次（`~/p/repo` 与 `~/p/repo/src` 都被加进了工作区），
 * 两者问出的根相同，只留第一次出现的。顺序跟着工作区目录走，所以「第一个仓库」
 * 是用户能预料的。不扫目录里嵌套的仓库和 submodule。
 *
 * ## 为什么这里直接调 `.execute()`，绕过队列
 *
 * 队列由 `Repository` 私有持有，而此刻 `Repository` **还不存在**——要先知道位置才能造它。
 * `getRepositoryLocation` 是 `LockPolicy.None`，本来就不进队列，绕过是安全的。
 * 此后一切命令都必须走 `repo.run()`。
 */
export async function discoverRepositories(
  cli: GitCli,
  directories: readonly string[],
): Promise<StartupResult> {
  if (directories.length === 0) return { kind: StartupKind.NoFolder };

  const repositories: RepositoryLocation[] = [];
  for (const directory of directories) {
    let location: RepositoryLocation;
    try {
      location = await getRepositoryLocation.execute(cli, directory);
    } catch (error) {
      // 这个目录不是仓库：**正常情况**，看下一个。
      if (error instanceof GitFailureError && error.code === GitErrorCode.NotAGitRepository) {
        continue;
      }
      // 其余一律当成 git 本身不可用。换下一个目录也只会得到同样的结果，不必再试。
      return {
        kind: StartupKind.GitUnavailable,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
    if (!repositories.some((known) => known.root === location.root)) repositories.push(location);
  }

  const [first, ...rest] = repositories;
  return first === undefined
    ? { kind: StartupKind.NoRepository }
    : { kind: StartupKind.Ready, repositories: [first, ...rest] };
}

/** 启动结果 → 给人看的一句话。`Ready` 时没有要说的。 */
export function describeStartup(result: StartupResult): string | undefined {
  switch (result.kind) {
    case StartupKind.Ready:
      return undefined;
    case StartupKind.NoFolder:
      return "No folder is open. Open a folder inside a git repository, then reload the window.";
    case StartupKind.NoRepository:
      return "None of the open folders is inside a git repository. Reload the window after running git init.";
    case StartupKind.GitUnavailable:
      return `Cannot run git: ${result.reason}. Reload the window after fixing it.`;
    default:
      return assertNever(result, "describeStartup");
  }
}
