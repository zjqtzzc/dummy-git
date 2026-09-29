/**
 * diff 的一边。一个 diff = 左边 + 右边 + 标题，左右可以是任意一种、自由组合
 * （`ARCHITECTURE.md` 第 10 题）。
 *
 * 放在 shared：左右怎么组合由界面决定，这个类型要跨过 webview ↔ 扩展的边界。
 * `path` 一律相对仓库根、以 `/` 分隔，扩展负责拼成绝对路径。
 *
 * 还会加的两种，在有消费者的阶段加进来：
 * - 工作区文件（第 2 阶段，Commit 面板）：可编辑，用普通 `file:` URI。
 * - 暂存区版本（第 7 阶段，冲突）：`:1:` / `:2:` / `:3:`。
 */
export enum DiffSideKind {
  /** 某个提交里的这个文件。 */
  Revision = "revision",
  /** 这一边不存在：新增文件的左边、删除文件的右边、根提交的左边。内容为空。 */
  Missing = "missing",
}

export type DiffSide =
  | {
      readonly kind: DiffSideKind.Revision;
      /** 完整 hash，不写 `<hash>^` 这类表达式：根提交没有父提交，由界面给出 `Missing`。 */
      readonly hash: string;
      /** 那个版本里的路径。改名过的文件，左边用旧名字。磁盘上不必存在。 */
      readonly path: string;
    }
  | {
      readonly kind: DiffSideKind.Missing;
      /** 只用来显示文件名、判断语言，没有内容。 */
      readonly path: string;
    };
