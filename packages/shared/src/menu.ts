/**
 * 原生右键菜单的上下文（页面元素上的 `data-vscode-context`）。
 *
 * VS Code 用它决定菜单项出不出现（`package.json` 菜单项的 `when` 条件），点了之后把整份交给扩展的菜单命令。
 * 键与值都是**对外的字符串**：和 `package.json` 里的 `when` 逐字对应，改一边必须改另一边。
 *
 * 两种写法并存，树的菜单项还没改过来：
 * - 每个菜单项一个键（提交列表）：键在，这一项就出现；值是它要作用的对象，扩展的菜单命令只读这个键。
 *   出不出现、作用于谁，都由页面按选中算好（`webview/src/logic/menuItems.ts`）。
 * - 节点类型加属性（树）：`when` 按 `Node` 等键组合条件，菜单命令从这些键里取参数。
 */
export const MenuContextKey = {
  /** 节点类型，值见 `MenuNodeValue`。 */
  Node: "dummyGit.node",
  /** 仓库根，菜单命令拼协议参数用。 */
  Repo: "dummyGit.repo",
  /** 远程名，只有远程分支有。 */
  Remote: "dummyGit.remote",
  /** 分支名（本地分支是全名；远程分支是不带远程名的那段）。 */
  Branch: "dummyGit.branch",
  /** 是不是当前分支（`true` / `false`）。 */
  Current: "dummyGit.current",
  /** 从这里建新分支时的起点：完整引用名或提交 hash。有它的节点才有 New Branch from Here…。 */
  Start: "dummyGit.start",
  /** 起点显示给人看的名字（输入框标题）。 */
  StartName: "dummyGit.startName",
  /** stash 的 hash。 */
  Stash: "dummyGit.stash",
  /** 文件路径，相对仓库根（Commit 面板的一个文件）。 */
  Path: "dummyGit.path",
  /** Copy Hash：要复制的完整 hash，按列表顺序。 */
  CopyHash: "dummyGit.copyHash",
  /** Cherry-Pick：要摘的提交（完整 hash），按要摘的顺序（从旧到新）。 */
  CherryPick: "dummyGit.cherryPick",
  /** Revert：要撤销的提交（完整 hash），按要撤的顺序（从新到旧）。 */
  Revert: "dummyGit.revert",
  /** Rebase onto Here：变基到的提交（完整 hash）。 */
  RebaseHere: "dummyGit.rebaseHere",
  /** Reset Current Branch to Here…：目标提交（完整 hash）。 */
  ResetTo: "dummyGit.resetTo",
  /** Edit Commit Message…：要改说明的提交（完整 hash）。 */
  Reword: "dummyGit.reword",
} as const;

/** `MenuContextKey.Node` 的取值。 */
export const MenuNodeValue = {
  LocalBranch: "localBranch",
  RemoteBranch: "remoteBranch",
  Stash: "stash",
  /** 冲突文件，两边都有内容（合并编辑器解决）。 */
  ConflictMerge: "conflictMerge",
  /** 冲突文件，一边删了、一边改了或只有一边新增（保留或删除）。 */
  ConflictDeleted: "conflictDeleted",
  /** 冲突文件，两边都删了（只能删除）。 */
  ConflictBothDeleted: "conflictBothDeleted",
  /** Changes 组里的已跟踪改动。 */
  Change: "change",
  /** 未跟踪文件。 */
  Untracked: "untracked",
} as const;
