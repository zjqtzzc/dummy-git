/**
 * 停在半路的操作。读 `.git` 里的状态文件得到，五种结果里的四种（没有操作是 `null`，不在这里）。
 *
 * 顺序有意义：rebase 进行中时目录在，就归 rebase，不再看 `MERGE_HEAD`。
 */
export enum OperationKind {
  Rebase = "rebase",
  Merge = "merge",
  CherryPick = "cherryPick",
  Revert = "revert",
}

/**
 * 一次停住的操作。`id` 在换到下一条提交时变（rebase、连续 cherry-pick），
 * 同一停里解决文件不会变——界面用它决定要不要重填说明。
 */
export interface OngoingOperation {
  readonly kind: OperationKind;
  /** 这一停的身份：正在处理的那条提交的完整 hash。 */
  readonly id: string;
  /**
   * 标题里的对象。merge 是对方分支名（说明里没有就用短 hash）；
   * rebase 是正在被变基的分支；cherry-pick 与 revert 是短 hash。
   */
  readonly subject: string;
  /**
   * 合并编辑器左栏括号里的字。只有 rebase 有：左栏是 onto 的内容，HEAD 又是游离的，
   * 这里放 onto 的短 hash。其余操作的左栏用当前分支名，不放在这里。
   */
  readonly current?: string;
  /** 合并编辑器右栏括号里的字：对方分支、或正在应用的那条提交的短 hash。 */
  readonly incoming: string;
  /** git 准备的说明，注释行已去掉。 */
  readonly message: string;
}
