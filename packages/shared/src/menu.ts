/**
 * 原生右键菜单的上下文（页面元素上的 `data-vscode-context`）。
 *
 * VS Code 用它决定菜单项出不出现（`package.json` 菜单项的 `when` 条件），点了之后把整份交给扩展的菜单命令。
 * 键与值都是**对外的字符串**（CLAUDE.md B.2）：和 `package.json` 里的 `when` 逐字对应，改一边必须改另一边。
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
} as const;

/** `MenuContextKey.Node` 的取值。 */
export const MenuNodeValue = {
  LocalBranch: "localBranch",
  RemoteBranch: "remoteBranch",
} as const;
