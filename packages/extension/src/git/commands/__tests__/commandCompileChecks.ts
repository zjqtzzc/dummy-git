/**
 * 「读 stdin 的命令，其输入参数必填」的**反向测试**。
 *
 * ## 为什么需要它
 *
 * 实测：进程层用 `stdio: ['ignore', …]`，git 读到的是立刻 EOF，
 * 而它**分不出「/dev/null」和「立刻关闭的管道」**。后果按命令而异：
 *
 * | 命令 | 空 stdin 的结果 |
 * |---|---|
 * | `git apply` / `git commit -F -` | 明确报错 ✅ |
 * | `git hash-object --stdin` | **exit 0，返回空内容的合法哈希** ❌ |
 * | `git update-index --stdin` | **exit 0，静默无操作** ❌ |
 *
 * 后两者最危险：返回值长得和正常结果一模一样，用它写对象库就是**静默的数据损坏**。
 * 所以约束不在进程层（它不知道 `--stdin` 是什么意思），而在命令层：
 * **包装函数的输入参数必填，忘了传就编译不过。**
 *
 * 没有这个文件的话，把 `message` 放宽成可选，所有调用点照常编译、`pnpm check` 全绿，
 * 约束无声消失。
 *
 * ## 为什么传的是 `undefined` 而不是少传一个参数
 *
 * `@ts-expect-error` 抑制该行的**所有**错误，不区分是哪一个。
 * 写成 `commit.execute(cli, "/repo")` 会少两个参数——`message` 与 `paths`——
 * 那么即使 `message` 变成可选，这一行**仍然因为缺 `paths` 而报错**，指令仍被消耗，
 * 测试仍绿。锁不住它声称的那个东西。
 *
 * 显式传 `undefined` 让这一行**只可能有一种错**：`message` 不接受 `undefined`。
 *
 * ## 改动本文件时必须做变异确认
 * 把 `commit` 的 `message` 放宽为 `message?: string`：`_missingMessage` 应变红（TS2578），
 * `_baseline` 应仍绿。
 */

import type { GitCli } from "../../cli.js";
import { commit } from "../commit.js";

declare const cli: GitCli;

/** 基线：参数齐全、类型正确，必须编译通过，否则下面那条的对照失去意义。 */
export const _baseline = (): Promise<void> => commit.execute(cli, "/repo", "消息", ["a.txt"], []);

/**
 * `commit` 走 `-F -`（消息从 stdin 读）。没有消息就是一次空 stdin 提交，
 * 而 git 对空提交消息是**明确报错**的——但那是运行时才知道。
 * 这条让它在编译期就不可能发生。
 */
export const _missingMessage = (): Promise<void> =>
  // @ts-expect-error 读 stdin 的命令，输入参数必填
  commit.execute(cli, "/repo", undefined, ["a.txt"], []);
