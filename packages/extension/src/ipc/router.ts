import type { CommandName, CommandParams, CommandResult } from "@dummy-git/shared";

/**
 * 一条命令的处理函数。参数与返回值都由协议表推出来，写错编译不过。
 *
 * 它**不认识 `vscode`，也不认识信封**——只是「给我参数，还你结果」。
 * 收消息、校验、配 id、发响应是 `Router`（M7-3）的事。
 */
export type Handler<K extends CommandName> = (
  params: CommandParams<K>,
) => Promise<CommandResult<K>>;

/** 协议表里每一条命令都必须有一个处理函数。 */
export type HandlerMap = { [K in CommandName]: Handler<K> };

/**
 * 注册全部 handler 的唯一入口。
 *
 * ## 为什么是「一次性给全」，而不是逐条 `handle("名字", fn)`
 *
 * 旧仓库正是逐条注册的，结果实测：协议声明 76 条、实际注册 89 条、**游离 13 条**。
 * 散落在 1720 行 `extension.ts` 里的 89 次 `.handle()` 调用，没有任何一处能看出
 * 「表里的每条都注册了吗」。**一次性给全，这个问题在结构上不存在**——
 * 而且整个对外表面积可以从上到下读一遍。
 *
 * ## 它拦住什么（全部实测，见 `__tests__/protocolCompileChecks.ts`）
 *
 * | 写错的方式 | 编译错误 |
 * |---|---|
 * | 漏一条 | `TS2345`（缺少属性） |
 * | 多一条（表外的命令） | `TS2345`（多余键被收窄成 `never`） |
 * | 返回类型不对 | `TS2322` |
 * | 参数用错字段 | `TS2339` |
 *
 * ## 为什么不是直接写 `const handlers: HandlerMap = { … }`
 *
 * 那样也能拦住这四种，**但只在写成字面量时**。TypeScript 的多余属性检查只对
 * 字面量生效；一旦有人改成 `const built = {…}; const handlers: HandlerMap = built;`
 * （变量），多注册就**静默通过**，而代码看起来毫无变化。实测确认。
 *
 * `Record<Exclude<keyof T, CommandName>, never>` 把「表外的键」收窄成 `never`，
 * 于是变量形态下同样拦得住——**保护不依赖调用方的书写习惯**。
 *
 * （这个区分来自 `LESSONS.md` 2026-09-21：守卫真实存在，但它守的东西
 * 与你以为的不是一个。那次的教训正是「完备性断言只拦漏、不拦多」。）
 */
export function defineHandlers<T extends HandlerMap>(
  handlers: T & Record<Exclude<keyof T, CommandName>, never>,
): HandlerMap {
  return handlers;
}
