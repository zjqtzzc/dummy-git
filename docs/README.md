# dummy-git 文档

> 从这里开始。dummy-git 是一个 VS Code 扩展：照 IntelliJ IDEA 的 Git 工具窗口，做底部的 Log 面板和侧栏的 Commit 面板。
> 文档写给接着开发的人（人或 AI）：要做什么、为什么这样做、按什么流程做。

## 先读这几份

1. **`../CLAUDE.md`**：违反了就打回的规则。
2. **`process/workflow.md`**：开发流程，一个阶段怎么开始、推进、结束。
3. **`product/roadmap.md`**：做到哪了，接下来做什么；还没排上的在 `backlog.md`，永远不做的在 `never.md`。
4. 要动哪块代码，先读那块的功能文档和 `tech/traps.md`。

## 想知道什么，看哪里

| 想知道 | 看 |
|---|---|
| 这条规则是什么、能不能破例 | `../CLAUDE.md` |
| 一件事按什么顺序做、交接和提交怎么做 | `process/workflow.md` |
| 文档、注释怎么写，写在哪 | `process/writing.md` |
| 测试写什么、不写什么、怎么跑 | `process/testing.md` |
| F5 调试窗口里是什么仓库、有哪些场景 | `process/manual-testing.md` |
| 有哪些阶段、各做什么 | `product/roadmap.md` |
| 以后可能做的 | `product/backlog.md` |
| 定了永远不做的 | `product/never.md` |
| 某个功能现在是什么样、为什么 | `product/features/` |
| 正在做的阶段的设计稿 | `phases/`（阶段结束时并进 `features/` 后删掉） |
| 某个技术问题选了什么、否决了什么 | `tech/architecture.md` |
| 其余为什么这么定 | `tech/decisions.md` |
| 会碰到的坑 | `tech/traps.md` |
| 实测的性能数字 | `tech/performance.md` |
| 锁与并发怎么处理 | `tech/locking.md` |
| 参照项目（IDEA、VS Code git、GitLens）是怎么做的 | `refs/` |
| 新阶段的设计稿怎么起头 | `templates/phase.md` |

## 改这里的代码，先读哪份

从代码找文档用这张表；每份文档开头也写了它管哪些代码。下面的路径都在 `packages/` 下。

| 改的是 | 先读 |
|---|---|
| `webview/src/log/`、`webview/src/logic/log/`（提交列表、过滤、高亮、详情、复制、提交右键菜单） | `product/features/log.md` |
| `webview/src/logic/log/graph/`、`refLabels.ts`、`graphOptions.ts`、`log/GraphCell.vue` | `product/features/graph.md` |
| `webview/src/log/BranchTree.vue`、`logic/log/branchTree.ts`、`git/commands/branch.ts` | `product/features/branches.md` |
| `webview/src/commit/CommitApp.vue`、`logic/commit/`、`git/commands/commit.ts`、`rollback.ts`、`status.ts` | `product/features/commit.md` |
| `webview/src/commit/StashView.vue`、`logic/stash/`、`git/commands/stash.ts` | `product/features/stash.md` |
| `webview/src/tree/`、`logic/tree/`、`ui/CheckBox.vue`、`vscode/diff.ts` | `product/features/trees.md` |
| `ui/ToolButton.vue`、`ui/MenuButton.vue`、`ui/PopupMenu.vue`、`ui/PopupList.vue`、`logic/popupMenu.ts`、`logic/popupPlacement.ts` | `product/features/menus.md` |
| `git/commands/remote.ts`、`update.ts`、`push.ts`、`core/autoFetch.ts`、`webview/src/push/`、`logic/push/` | `product/features/sync.md` |
| `git/commands/integrate.ts`、`resolve.ts`、`operation.ts`、`vscode/mergeEditor.ts` | `product/features/conflicts.md` |
| `git/commands/reset.ts`、`reword.ts` | `product/features/history.md` |
| `vscode/dialogPanel.ts`、`ui/DialogShell.vue` | `product/features/dialogs.md` |
| `ipc/operation.ts`、`ipc/loggedUi.ts`、`ipc/brief.ts`、`git/cli.ts` 的日志 | `product/features/logging.md` |
| `core/repository.ts`、`core/debounce.ts`、`vscode/watcher.ts`（刷新） | `tech/architecture.md` 第 11 题 |
| `core/operation.ts`、`git/commands/lock.ts`（排队与锁） | `tech/architecture.md` 第 12 题、`tech/locking.md` |
| `ipc/`（协议、Router、参数校验）、`webview/src/logic/menuItems.ts`、`vscode/menu.ts`（右键菜单） | `tech/decisions.md`「右键菜单：每个菜单项一个键」、`tech/architecture.md` 第 4 题 |
| `logic/icons.ts` | `tech/decisions.md`「图标」 |
| `git/cli.ts`、`git/failure.ts`、`git/parsers/`（起进程、退出码、解析、错误分类） | `tech/architecture.md` 第 7、15 题 |
| 任何 git 命令行 | `tech/traps.md` §1 |

参照项目的源码是本地副本（`../.notes/`，不进版本库），需要时自己下载。

## 常用命令

```bash
pnpm check                       # 提交前必过：typecheck + lint + test + build
pnpm docs:remind                 # 提交前看线索：哪些文档可能要跟着改，见 process/workflow.md §3
pnpm test:old-git                # 在 Ubuntu 20.04（git 2.25）的容器里跑测试，动了 git 命令行时跑
pnpm debug:setup <场景>          # 换 F5 调试窗口里的仓库，见 process/manual-testing.md
```
