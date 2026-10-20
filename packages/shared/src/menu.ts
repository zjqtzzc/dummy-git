/**
 * 原生右键菜单的上下文（页面元素上的 `data-vscode-context`）。
 *
 * 每个菜单项一个键，键就是这一项的命令 id：键在，这一项就出现（`package.json` 里它的 `when` 只看这个键）；
 * 值是这条命令要的协议参数（不含 `repo`，`repo` 另放一个键），扩展的菜单命令原样取出、过同一张校验表。
 * 出不出现、作用于谁，都由页面按选中算好（`webview/src/logic/menuItems.ts`）。
 *
 * 键都是**对外的字符串**：和 `package.json` 的命令 id、`when` 逐字对应，改一边必须改另一边。
 */
export const MenuContextKey = {
  /** 仓库根，菜单命令拼协议参数用。 */
  Repo: "dummyGit.repo",

  // 提交列表
  CopyHash: "dummyGit.copyHash",
  CherryPick: "dummyGit.cherryPick",
  Revert: "dummyGit.revertCommit",
  RebaseHere: "dummyGit.rebaseHere",
  ResetTo: "dummyGit.resetTo",
  Reword: "dummyGit.rewordCommit",

  // 分支树
  Checkout: "dummyGit.checkout",
  CheckoutRemote: "dummyGit.checkoutRemote",
  NewBranch: "dummyGit.newBranch",
  RenameBranch: "dummyGit.renameBranch",
  DeleteBranches: "dummyGit.deleteBranches",
  UpdateBranch: "dummyGit.updateBranch",
  PushBranch: "dummyGit.pushBranch",
  MergeBranch: "dummyGit.mergeBranch",
  RebaseBranch: "dummyGit.rebaseBranch",

  // Stash
  PopStash: "dummyGit.popStash",
  ApplyStash: "dummyGit.applyStash",
  DropStash: "dummyGit.dropStash",

  // Commit 面板
  OpenMergeEditor: "dummyGit.openMergeEditor",
  MarkResolved: "dummyGit.markResolved",
  KeepFile: "dummyGit.keepFile",
  RemoveConflictFile: "dummyGit.removeConflictFile",
  RollbackFile: "dummyGit.rollbackFile",
  AddUntracked: "dummyGit.addUntracked",
  DeleteUntracked: "dummyGit.deleteUntracked",
} as const;
