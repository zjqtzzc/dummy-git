/**
 * 穷尽性检查。所有 `switch` 必须以此收尾。
 *
 * 编译期：漏掉 union 的任一分支 → 传入的类型不是 `never` → 编译失败。
 * 运行期：只有在越过边界校验的脏数据才可能走到这里，视为 bug。
 */
export function assertNever(value: never, context?: string): never {
  const detail = context === undefined ? "" : ` (${context})`;
  throw new Error(`Unhandled variant${detail}: ${JSON.stringify(value)}`);
}
