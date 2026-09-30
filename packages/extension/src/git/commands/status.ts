import type { StatusSnapshot } from "@dummy-git/shared";
import { runRaw } from "../failure.js";
import { parseStatus, STATUS_ENV, statusArgs } from "../parsers/status.js";
import type { GitCommand } from "./command.js";
import { LockPolicy } from "./lock.js";

/**
 * 读工作区的改动列表。
 *
 * 这是第一条**要解析输出**的命令，把 M3 的 parser 接了进来。
 * 在此之前 parser 是「能用但没人用」的纯函数。
 *
 * ## 三样东西的分工
 *
 * - `statusArgs()` / `STATUS_ENV` 在 **parser 那边**——改了 `--porcelain=v2`，
 *   parser 就会坏，两者必须一起改，放在一起才不会漏。
 * - `runRaw()` 在 **M4**——跑，失败就抛，且 stdout 保持字节。
 * - 本文件只负责**把它们串起来**，并声明这条命令的元数据。
 *
 * ## `GIT_OPTIONAL_LOCKS=0` 的欠条在这里兑现
 *
 * 这张欠条跨了三个里程碑：M2 决定不放进全局强制环境变量（进程层只看到一个
 * 字符串数组，靠 `args[0] === "status"` 判断等于把 git 语义焊进下层），
 * M3 把常量准备好，M5 的命令层真正传进去。
 *
 * 它有三个作用，缺一不可（`.notes/specs/locking.md` §6）：
 * 1. 防 status 回写 index → 触发 watcher → 又跑 status 的**刷新回路**
 * 2. 避免撞外部锁（次要——status 本来就不会因此失败）
 * 3. **让 status 免于被写锁串行化**：正因为它证明了自己不写 index，
 *    才能归 `LockPolicy.None`
 *
 * ⚠️ 删掉 `STATUS_ENV` 不会报任何错，只会让刷新回路悄悄回来。
 */
export const getStatus: GitCommand<[repository: string], StatusSnapshot> = {
  // 靠 STATUS_ENV 保证不写 index，才敢标 None——两者是绑定的，见上。
  lock: LockPolicy.None,

  execute: async (cli, repository) => {
    // 用 runRaw 而非 run：parser 吃 Buffer，不吃字符串。
    const result = await runRaw(cli, statusArgs(), { cwd: repository, env: STATUS_ENV });
    return parseStatus(result.stdout);
  },
};
