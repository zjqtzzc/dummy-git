import { GitErrorCode } from "@dummy-git/shared";
import { Repository } from "../core/repository.js";
import type { GitCli } from "../git/cli.js";
import { getRepositoryLocation } from "../git/commands/index.js";
import { GitFailureError } from "../git/failure.js";

/**
 * 为一个目录打开 `Repository`。
 *
 * ## 为什么参数是「目录」而不是「workspace folder」
 *
 * 为了这一层能在纯 node 下测。真正与 VSCode 有关的只有一句
 * 「取第一个 workspace folder」，那几行留在 `activate.ts` 里。
 *
 * ## 为什么这里直接调 `.execute()`，绕过队列
 *
 * 队列由 `Repository` 私有持有（M6），而此刻 `Repository` **还不存在**——
 * 要先知道根目录才能造它。这是唯一一处合理的绕过，且是安全的：
 * `getRepositoryLocation` 是 `LockPolicy.None`，本来就不进队列
 * （`CommandQueue.run` 对 `None` 直接 `return action()`）。
 *
 * 此后一切命令都必须走 `repo.run()`。
 *
 * ## 第一版只支持一个仓库
 *
 * `PLAN.md`「闭环的四个环节」：下面三层（命令带 `repo` 参数、锁是实例字段、
 * 协议带标识）早就就绪，缺的一直是**没有人负责产生那个仓库**。这里补上。
 *
 * 多仓库的升级路径没被堵死：`Repository` 本来就可实例化多份，协议每条消息都带 `repo`。
 * 要支持时改的是这个函数的调用方，不是整条链。
 */
export async function openRepository(cli: GitCli, directory: string): Promise<Repository> {
  // 传进来的可能是仓库里的任意子目录，`--show-toplevel` 会往上找到根。
  // 不自己找 `.git`：worktree 与 submodule 的 `.git` 是**文件**不是目录，
  // 且可能在更上层。这个判断交给 git（见 `commands/location.ts`）。
  const { root } = await getRepositoryLocation.execute(cli, directory);
  return new Repository(root, cli);
}

/**
 * 失败是不是「这儿根本不是仓库」。
 *
 * 那是**正常情况**（用户在一个非仓库目录里打开了编辑器），不是故障——
 * 应该安静地什么都不做，而不是弹错误。其他失败（git 不存在、权限不足）要报出来。
 *
 * M4 那两个错误码里，`NotAGitRepository` 的**唯一**消费者原本是 M6 的状态机；
 * 这是第二个。
 */
export function isNotARepository(error: unknown): boolean {
  return error instanceof GitFailureError && error.code === GitErrorCode.NotAGitRepository;
}
