/**
 * 协议封闭性的**反向测试**。
 *
 * ## 为什么需要它
 *
 * 「漏注册/多注册编译不过」是协议封闭性的全部保证。但编译期约束有个特点：
 * **`pnpm check` 只证明「符合约束」，不证明「约束还在」。**
 * 把 `defineHandlers` 放宽成 `(h: HandlerMap) => h`，所有调用点照常编译、
 * 全绿，而保护已经没了——验过一次之后再无保护。
 *
 * `@ts-expect-error` 的特殊之处是**它会因为「不再报错」而失败**
 * （`TS2578: Unused '@ts-expect-error' directive`），这是唯一能锁住
 * 编译期约束不被悄悄放宽的机制。
 *
 * ## 为什么不是 `.test.ts`
 *
 * 这里没有运行时断言可写——约束在编译期。放进 `.test.ts` 会让 vitest 报
 * 「文件里没有测试」。它由 `pnpm typecheck` 检查（tsc 覆盖 src 下所有 .ts），
 * 由 esbuild 从入口可达性排除（没人 import 它，不会进产物）。
 *
 * ## 写法要求：每行只能有一种错
 *
 * `@ts-expect-error` 抑制该行的**所有**错误，不区分是哪一个。实测过一个假阴性：
 * 约束已被放宽、但那行因为参数个数不对仍然报错 → 指令仍算「被用到」→ 测试仍绿。
 * 所以下面每个 stub 的参数与返回类型都是**正确的**，
 * 唯一的错误来源就是「缺一条」或「多一条」。
 *
 * ## 改动这个文件时
 *
 * 必须做**变异确认**：把 `defineHandlers` 临时放宽，确认对应那条变红。
 * 只确认「通过」不够——要确认它抓的是我们以为的那个东西：
 * - 放宽为 `(handlers: HandlerMap): HandlerMap`：`_extra` 应变红（TS2578），`_missing` 仍绿
 *   （漏注册由 `HandlerMap` 的必填属性拦，与这次放宽无关）。
 * - 再放宽为 `(handlers: Partial<HandlerMap>)`：`_missing` 应变红。
 */

import type {
  Commit,
  CommitFileChange,
  CommitSkeleton,
  Ref,
  StatusSnapshot,
} from "@dummy-git/shared";
import { defineHandlers } from "../router.js";

/** 类型正确的空实现。用它们把「参数/返回值写错」这个错误来源排除掉。 */
const skeletonStub = async (): Promise<CommitSkeleton[]> => [];
const detailsStub = async (): Promise<Commit[]> => [];
const filesStub = async (): Promise<CommitFileChange[]> => [];
const reposStub = async (): Promise<readonly string[]> => [];
const refsStub = async (): Promise<Ref[]> => [];
const openDiffStub = async (): Promise<null> => null;
const statusStub = async (): Promise<StatusSnapshot> => ({ changes: [] });

/** 基线：三条齐全、类型正确 —— 必须编译通过，否则下面两条的对照失去意义。 */
export const _baseline = defineHandlers({
  getRepositories: reposStub,
  getSkeleton: skeletonStub,
  getCommitDetails: detailsStub,
  getRefs: refsStub,
  openDiff: openDiffStub,
  getCommitFiles: filesStub,
  getStatus: statusStub,
  commit: openDiffStub,
  amend: openDiffStub,
  rollback: openDiffStub,
  fetch: openDiffStub,
  pull: openDiffStub,
  push: openDiffStub,
  checkout: openDiffStub,
  checkoutRemote: openDiffStub,
  newBranch: openDiffStub,
});

/**
 * 方向一：**漏注册**。少了 `getCommitFiles`。
 *
 * 它守的是「协议表里的每一条都有人实现」。
 */
export const _missing = defineHandlers(
  // @ts-expect-error 漏注册：协议表里的每一条都必须有处理函数
  { getSkeleton: skeletonStub, getCommitDetails: detailsStub },
);

/**
 * 方向二：**多注册**。多了一条协议表里没有的 `cherryPick`。
 *
 * 它守的是「不存在游离于协议之外的命令」。
 *
 * ## 为什么这里必须先存进变量，而不是直接写字面量
 *
 * 字面量有 TypeScript 自带的多余属性检查（`TS2353`）兜底，它与 `defineHandlers` 毫无关系。
 * 于是把 `defineHandlers` 放宽成 `(h: HandlerMap)` 之后，这一行**照样报错**、
 * 指令照样算「被用到」、测试照样绿——**它锁的是字面量检查，不是它声称的那个机制**。
 *
 * 两个机制只在**变量形态**下才分得开。所以这里必须传变量。
 */
const extraHandlers = {
  getRepositories: reposStub,
  getSkeleton: skeletonStub,
  getCommitDetails: detailsStub,
  getRefs: refsStub,
  openDiff: openDiffStub,
  getCommitFiles: filesStub,
  getStatus: statusStub,
  commit: openDiffStub,
  amend: openDiffStub,
  rollback: openDiffStub,
  fetch: openDiffStub,
  cherryPick: async (): Promise<CommitFileChange[]> => [],
};

// @ts-expect-error 多注册：不允许存在协议表之外的命令
export const _extra = defineHandlers(extraHandlers);
