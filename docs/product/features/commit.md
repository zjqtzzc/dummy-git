# Commit 面板

> 侧栏 Commit 面板的 Commit 模式：看未提交的改动、勾选、提交、Amend、Rollback，以及为什么这样做。改这块的行为或代码前先读本文；行为变了就改本文。
> Stash 模式见 `product/features/stash.md`；冲突组与停在半路的操作见 `product/features/conflicts.md`；树的共同行为见 `product/features/trees.md`。

## 位置与布局

- 活动栏上 Dummy Git 自己的按钮（图标 `resources/log.svg`），点开是侧栏的 Commit 面板。不挂进源代码管理面板，也不挂进资源管理器等别人的容器（让用户自选挂靠在 `product/backlog.md`「暂缓」）。
- 从上到下：
  - **Commit / Stash 切换栏**；
  - **工具栏**：Rollback、Stash、View Options、全部展开、全部收起。View Options 只有分组依据（`Group By` → `Directory`），和 Stash 的各记各的（`product/features/trees.md`「分组依据」）。Rollback 放在这里，远离提交按钮，防止误点；
  - **文件树**：占满剩余高度，可以滚动；
  - **底部固定区**：Amend 复选框、提交说明框（默认几行高，可往下拉高）、Commit 按钮。始终贴底，不会被文件树挤走。
- 不设刷新按钮：文件一变，监听就会自动刷新。

## 显示什么

- 数据来自一条 `git status --porcelain=v2 --branch -z -uall`。`-uall` 让未跟踪文件逐个列出，不折叠成目录，否则没法单独勾里面的某个文件。
- **只看 HEAD ↔ 工作区**，界面上不区分暂存区：新增的（不管有没有 add）是 `A`，删除的（不管是 rm 还是 git rm）是 `D`，其余是 `M`。add 之后又在磁盘上删掉的（`AD`）不显示，也不替用户清理暂存区（同 IDEA）：后台的写操作会和用户终端里的 git 抢锁。
- **分组**，从上到下：`Conflicts`（有冲突时才有，没有复选框）、`Changes`（已跟踪的 A / M / D）、`Unversioned Files`（未跟踪）。空组不显示。每组各自是一棵目录树。
- 没有改动时，树的区域正中一行灰字 `No changes`；Rollback、全部展开 / 收起置灰，说明框和 Amend 照常可用（可以只改上一次的说明）。

## 勾选

- **默认都不勾**。组的标题行也有复选框，勾它等于勾这一组全部。宁可多点一下，也不误提交垃圾文件。
- 刷新后按路径保持勾选；消失的路径移出勾选集合；新出现的一律不勾。所以原本全勾的组会变成半选，提醒你有新文件没勾。
- 勾选存进 `viewState`：面板收起再展开、重新加载窗口都还在。

## 提交

- 说明为空（只有空白也算），或者一个文件都没勾时，Commit 按钮置灰（Amend 例外，见下面）。
- **勾了哪些就提交哪些，和暂存区里还有什么无关**：`git commit --only -F - -- <勾的路径>`。不加 `--only` 的话，用户在终端里 `git add` 过的别的文件会被一起提交进去。勾了的未跟踪文件先 `add`；提交失败时（比如钩子拒绝），把刚 `add` 的撤回（`reset -q --`），让它们在界面上仍是未跟踪。
- **改名的两头一起交给 git**：界面上改名只有一行，平常是新路径；新路径又从磁盘上删掉时（`RD`），画成旧路径上的删除。由扩展按当前 `git status` 补上另一头：只交新路径会剩下一个 `D`，只交旧路径会剩下一个 `AD`，Stash 还会先存下一条再报 `pathspec did not match`。IDEA 的画法相同（`GitChangesCollector` 的 `RD` → 旧路径删除）：它的提交先把不在这次提交里的暂存项退出去、提交后再放回，`AD` 不放回，所以结果干净；它的 Rollback 只对旧路径 `checkout HEAD`，会留下 `AD`。
- 说明原样提交，只去掉首尾的空行，经 stdin 传入（`-F -`）：`-m` 传不了控制字符，消息里有引号、换行时也容易出岔子。
- 说明框里 Ctrl+Enter（Mac 上 Cmd+Enter）等于点 Commit；按钮置灰时无效，勾着 Amend 时就是 Amend。快捷键只有这一个，在 webview 里监听，不在 `package.json` 注册。
- 进行中：Commit 和 Rollback 按钮置灰，Commit 按钮的文字变成 `Committing…`；说明框和复选框照常可以操作。成功不弹通知，Log 里自己会出现新提交。失败走错误出口，说明和勾选原样保留，改一改就能重试。
- 提交成功才清空说明框，失败不清。说明框的内容在面板隐藏、重新加载窗口后都还在：每次输入停手后存进 `viewState`（webview 没有可靠的关闭事件，不能等关闭时再存）。

## Amend

- 勾上：当前输入存为普通草稿，说明框换成 HEAD 的说明，每次都重新取，不保留上次 Amend 改到一半的内容。取消勾选：说明框换回普通草稿，没有草稿就清空。
- 仓库还没有任何提交时，Amend 置灰。一个文件都不勾也能 Amend，就是只改说明，这时 Commit 按钮只看说明是不是空的。
- `git commit --amend --only -F - -- <勾的路径>`。会变成空提交时 git 会拒绝，显示 git 原文，不加 `--allow-empty`。
- 不检查上一个提交有没有推送过。
- 成功后说明框和草稿都清空，Amend 也顺带取消勾选。
- 有操作停在半路时（merge、cherry-pick、revert 进行中），Commit 与 Amend 都会被锁住，见 `product/features/conflicts.md`。

## Rollback

- 只管已跟踪的改动（`Changes` 组）：恢复成 HEAD 的样子，暂存区和工作区一起；新增的文件连磁盘上的一起删。未跟踪文件用右键菜单的 Delete。
- **作用于选中的文件，不看勾选**（同 IDEA 的 `RollbackAction`，2026-10-20）：工具栏的 Rollback 和右键的 Rollback 是同一份规则（`logic/commit/workingChanges.ts` 的 `rollbackArgs`）。选中目录或 `Changes` 组标题等于选中它下面列出的全部；选中里混着未跟踪文件、冲突文件就撤不了（全部严格），工具栏按钮置灰、右键没有这一项。**什么都没选时**工具栏的 Rollback 撤 `Changes` 组的全部（同 IDEA：`changes.isEmpty()` 时取全部），`Changes` 组为空时置灰。勾选从此只管提交和 Stash：同一个复选框不再同时挑「要提交的」和「要撤的」。
- 一条 `git restore --source=HEAD --staged --worktree -- <路径>`，就能覆盖修改、删除、新增、改名几种情况（实测）；改名的两头一起交（同提交），新路径会被删掉、旧路径被恢复。
- 确认用 VS Code 原生模态框：写明文件数、列出前 5 个文件名（更多时以 `…` 结尾），按钮 `Rollback`，另有取消。改动删了就找不回来，所以要拦一下。

## 打开 diff

左边是 HEAD 的版本（只读），右边是工作区里的真实文件（`file:`，在 diff 里可以直接编辑保存）。新增和未跟踪的左边为空，删除的右边为空。HEAD 的 hash 由 `getStatus` 顺带给出（`--branch`），和改动同一次调用。打开与跟随的规则同所有文件树（`product/features/trees.md`）。

## 右键菜单

| 文件 | 菜单项 |
|---|---|
| `Changes` 里的文件 | Rollback |
| 未跟踪文件 | Add to Git（`git add`，不确认）、Delete（原生模态确认 `Delete <文件名>? This cannot be undone.`，直接删磁盘上的文件） |
| 冲突文件 | 见 `product/features/conflicts.md` |

- **多选、目录、组**（2026-10-20 项目负责人定）：除了 Open in Merge Editor（合并编辑器一次开一个文件），都作用于选中的全部；目录、组等于它下面列出的全部文件，只动列出来的，不碰目录里没列出的（被忽略的文件等）。全部严格：混着别的种类（比如未跟踪文件里夹着已跟踪的改动）就没有这一项。
- 规则和单个文件一样，同一类的合成一次问：Delete 一批未跟踪文件问一次 `Delete 3 files? This cannot be undone.`，说明里列出前 5 个文件名；Add to Git 一条 `git add`，不问。
