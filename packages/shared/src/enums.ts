/**
 * 闭集枚举的唯一归属地。
 *
 * 纪律（CLAUDE.md §B）：
 *   - 值用简单字符，不加前缀、不做修饰；
 *   - 值只承担身份，不承担内容 —— 只可用于 `===` / `switch` / 对象 key；
 *   - **本文件零数据表**。CLI flag、图标、文案等映射一律放在消费方模块。
 *
 * M1 阶段只放下面这一组作为模式范例与验收样本，M6 定稿仓库状态类型时会扩充。
 */

export enum RefKind {
  LocalBranch = "localBranch",
  RemoteBranch = "remoteBranch",
  Tag = "tag",
  Head = "head",
}

/**
 * 模式范例：多形态领域概念用 tagged union，enum 做 tag（CLAUDE.md §B.6）。
 *
 * 关键点：远程分支把 `remote` 与 `name` **分开存**，而不是留一个
 * `"origin/main"` 字符串事后去猜。旧仓库 `ad9f396` / `da91d25` / `01b15db`
 * 三条 fix 的根因正是缺这个建模。
 */
export type Ref =
  | { readonly kind: RefKind.LocalBranch; readonly name: string }
  | { readonly kind: RefKind.RemoteBranch; readonly remote: string; readonly name: string }
  | { readonly kind: RefKind.Tag; readonly name: string }
  | { readonly kind: RefKind.Head };
