/**
 * 开在编辑器标签页里的对话框。每种只开一个标签。
 *
 * 放在 shared：页面关自己的标签时要说是哪一种。
 */
export enum DialogKind {
  Push = "push",
  Reword = "reword",
  Rollback = "rollback",
  Stash = "stash",
}
