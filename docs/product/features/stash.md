# Stash

> Stash 怎么存、怎么看、怎么取回和删除，以及为什么这样做。改 stash 的行为或相关代码前先读本文；行为变了就改本文。
> 照 IDEA Commit 工具窗口的 Stash 页。

## 存

Commit 面板工具栏上，Rollback 旁边的 **Stash** 按钮（codicon `archive`）。有改动就能点，不问名字，说明用 git 自动生成的（`WIP on main: 1a2b3c4 fix login`）。

| 勾选 | 按钮提示 | 做法 |
|---|---|---|
| 勾了文件 | `Stash Selected` | 只存勾了的，见下面 |
| 没勾 | `Stash All` | `git stash push -u`，存全部改动 |

- 永远带 `-u`：勾了的未跟踪文件一起存，取回时还原；没勾的（不管跟不跟踪）原样留下。不分情况，逻辑最简单。
- 走本地道与进度出口；完成消息用 git 自己的那句（`Saved working directory and index state …`）。

**Stash Selected**：`git stash push -- <路径>` 只按路径清理工作区，存进去的却是**整个暂存区**。没勾的已暂存改动（新增、改名、删除）会一起进 stash，同时还留在工作区，Apply 时再来一遍（git 2.25、2.43 实测）。所以在同一条本地道命令里分四步：
1. `git write-tree` 记下整个暂存区；
2. 列出没勾、但已暂存的路径（`diff --cached --name-only --no-renames`，改名拆成新旧两个路径）；
3. 把它们退回成未暂存（`restore --staged`）；
4. `stash push -u -- <勾的>`；之后（stash 失败也一样）用 `restore --source=<第 1 步的树> --staged` 原样还原它们，部分暂存的文件也还原成暂存的那一版。

另外两条：
- 改名的文件带上旧路径（同提交）。
- 勾了的路径里有**已暂存的删除**（改名的旧路径、`git rm` 过的）时，git 先把 stash 存下，再在清理工作区时报 `pathspec did not match` 退出：stash 建了，改动还留在工作区。不带 `-u` 时则直接拒绝。所以先 `restore --staged` 把它们退回成未暂存的删除。代价：Apply 回来后，改名显示成新增 + 删除两行。

否决过：
- 自己用 `commit-tree` 造 stash 提交再 `stash store`：等于重写一遍 `git stash`，未跟踪文件那份附属提交也得自己造。
- 有别的已暂存改动时拒绝执行：最常见的用法（暂存了一部分，再 stash 另一部分）就用不了了。
- `stash push --staged`：语义不同（只存已暂存的那部分），而且要 git 2.35。

## 看：Commit 面板的 Stash 模式

- 面板顶部的切换栏选 Stash。下面一行是 Stash 模式的工具栏；底部（Amend、说明、Commit）隐藏。没有 stash 时，正中一行灰字 `No stashes`。
- 一棵树：每条 stash 一个顶层节点，最新的在最上，默认收起。标题是 git 生成的说明，右边灰字是时间，写法和 Log 相同（共用 `logic/utils/time.ts`）。展开是它改了的文件，按目录整理，没有复选框；目录默认展开。
- 存了未跟踪文件的 stash，那部分在附属提交（`stash@{n}^3`，`git stash show` 看不到）里，和已跟踪的合在一棵树里，显示为新增 `A`。
- 同一个文件可能出现在好几条 stash 里，所以节点 id 前面都加上 stash 的 hash。
- 文件列表用 Log 的 `getCommitFiles`：已跟踪的部分问 stash 本身（它是合并提交，对第一个父提交求差），未跟踪的部分问附属提交。要用 `-m --first-parent`：git 2.31 之前单用 `--first-parent` 时，合并提交的输出是空的，退出码却是 0。曾经因此 stash 展开后是空的，用户以为没存上，就把它删了。
- 打开 diff 的规则和其他文件树一样：双击或回车打开；单击或方向键只在前台已经是 diff 时才跟着换。左边是存 stash 时所在的提交，右边是 stash 里的版本，都只读；未跟踪文件左边为空。
- 列表在 stash 有变化时重新载入（`stash` 域）。

## 取回与删除

- 工具栏：**Apply**（`AppIcon.Unstash`，取回、保留这条）、**Delete**（codicon `trash`）。
- stash 那一行的右键菜单：Pop、Apply ｜ Delete。Pop 是取回成功后删掉，最常用，排在最前。
- 选中 stash 那一行，或者它下面的任何一个文件，都算选中了这条 stash。
- **一律按 hash 认 stash。** `git stash drop` / `pop` 只认 `stash@{n}`、不认 hash，而序号会随存、删而变，拿界面上的序号去删可能删错一条。所以 drop / pop 在同一条本地道命令里，先按 hash 查出它现在的序号，再执行。`apply` 直接认 hash。
- Apply / Pop 不带 `--index`：取回后原来的暂存状态没了，全部变成未暂存。
- Delete 弹原生模态确认 `Delete the stash "…"? This cannot be undone.`，确认后状态栏用 git 的那句 `Dropped stash@{n} (<完整 hash>)`。真删错了，可以用日志里的完整 hash `git stash store` 找回。删除后**不**弹带 Restore 的通知（`product/never.md`）。
- 完成消息：Apply / Pop 是自己写的（`Applied …`、`Applied and dropped …`），因为 git 的输出是一整段 status。
- Apply、Pop 走进度出口；Delete 只改一个引用，立刻就能看到，不走。
- 取回时冲突：git 不删 stash（Pop 也一样），冲突文件显示在 Commit 面板的冲突组里（`product/features/conflicts.md`）；解决之后，stash 要自己删。

## 以后可能做（`product/backlog.md`）

单文件 Stash；只存已暂存或未暂存的那部分；Stash 重命名；取回时可选还原暂存状态（`--index`，同 IDEA 的 Reinstate index）。
