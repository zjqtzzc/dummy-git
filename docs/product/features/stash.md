# Stash

> Stash 怎么存、怎么看、怎么取回、改名和删除，以及为什么这样做。改 stash 的行为或相关代码前先读本文；行为变了就改本文。
> 照 IDEA Commit 工具窗口的 Stash 页。

## 存

Commit 面板工具栏上，Rollback 旁边的 **Stash** 按钮（`AppIcon.Stash`：箭头落进托盘）。有改动就能点，不问名字，说明用 git 自动生成的（`WIP on main: 1a2b3c4 fix login`）。**工具栏永远存全部**（提示 `Stash All`，`git stash push -u`），不看勾选、不看选中（同 IDEA 的 `Git.Stash.Silently`）。选中经常只是在看 diff，Stash 又没有确认框。

右键 **Stash**：打开编辑器标签页（`product/features/dialogs.md`），不再直接存。谁能点仍由现在的规则定：选中的文件（目录、组等于下面列出的全部），可含未跟踪；混着冲突文件就没有这一项（全部严格）。勾选只管提交。

标签里一棵含 Changes 与 Unversioned 的文件树（不含冲突），打开时勾上刚才要存的那些，可以改勾。名字输入框预填 git 那种 `WIP on main: 1a2b3c4 fix login`（没改就不传 `-m`，git 自己生成；改过才 `-m`，列表变成 `On main: 你写的`）。底栏左侧灰字 `N files`，右侧 Cancel / Stash；一个都没勾时 Stash 置灰。点 Stash 关标签，后台按勾上的路径存。双击开 diff 同 Commit 面板。

- 永远带 `-u`：选中的未跟踪文件一起存，取回时还原；没选的（不管跟不跟踪）原样留下。不分情况，逻辑最简单。
- 走本地道与进度出口；完成消息用 git 自己的那句（`Saved working directory and index state …`）。

**右键只存一部分**：`git stash push -- <路径>` 只按路径清理工作区，存进去的却是**整个暂存区**。没选的已暂存改动（新增、改名、删除）会一起进 stash，同时还留在工作区，Apply 时再来一遍（git 2.25、2.43 实测）。所以在同一条本地道命令里：记下整个暂存区；把没选的已暂存路径、以及选中的已暂存删除（改名的旧路径、`git rm` 过的）退回成未暂存；只存选中的；之后从记下的暂存区还原没选的那些（部分暂存的文件也还原成暂存的那一版）。stash 失败则整份还原。收尾还原失败不盖住 stash 的结果。命令行见 `git/commands/stash.ts` 的 `stashPaths`。

另外：改名的两头一起交（同提交）。选中已暂存删除时先退暂存，代价是 Apply 回来后改名显示成新增 + 删除两行。

IDEA、VS Code git、GitLens 都是一条 `stash push`，没有「先退暂存再还原」。这条绕法是我们为上面那个 git 坑加的。

否决过：
- 自己用 `commit-tree` 造 stash 提交再 `stash store`：等于重写一遍 `git stash`，未跟踪文件那份附属提交也得自己造。
- 有别的已暂存改动时拒绝执行：最常见的用法（暂存了一部分，再 stash 另一部分）就用不了了。
- `stash push --staged`：语义不同（只存已暂存的那部分），而且要 git 2.35。

## 看：Commit 面板的 Stash 模式

- 面板顶部的切换栏选 Stash。下面一行是 Stash 模式的工具栏；底部（Amend、说明、Commit）隐藏。没有 stash 时，正中一行灰字 `No stashes`。
- 一棵树：每条 stash 一个顶层节点，最新的在最上，默认收起。标题是 git 生成的说明，右边灰字是时间，写法和 Log 相同（共用 `logic/utils/time.ts`）。展开是它改了的文件，按目录整理（View Options 关掉 `Directory` 就平铺，和 Commit 面板的各记各的，`product/features/trees.md`「分组依据」），没有复选框；目录默认展开。
- 存了未跟踪文件的 stash，那部分在附属提交（`stash@{n}^3`，`git stash show` 看不到）里，和已跟踪的合在一棵树里，显示为新增 `A`。
- 每条 stash 是文件树的一组，组的 id 是 hash，同一个文件出现在好几条 stash 里 id 也不撞（规则见 `product/features/trees.md`「文件树」）。
- 文件列表用 Log 的 `getCommitFiles`：已跟踪的部分问 stash 本身（它是合并提交，对第一个父提交求差），未跟踪的部分问附属提交。要用 `-m --first-parent`：git 2.31 之前单用 `--first-parent` 时，合并提交的输出是空的，退出码却是 0。曾经因此 stash 展开后是空的，用户以为没存上，就把它删了。
- 打开 diff 的规则和其他文件树一样：双击或回车打开；单击或方向键只在前台已经是 diff 时才跟着换。左边是存 stash 时所在的提交，右边是 stash 里的版本，都只读；未跟踪文件左边为空。
- 列表在 stash 有变化时重新载入（`stash` 域）。

## 取回、改名与删除

- 工具栏：**Apply**（`AppIcon.Unstash`，取回、保留这条）、**Delete**（codicon `trash`）、View Options，以及全部展开、全部收起（同 Commit 模式的工具栏，2026-10-20 项目负责人提）。
- stash 那一行的右键菜单：Pop、Apply ｜ Rename… ｜ Delete。Pop 是取回成功后删掉，最常用，排在最前。
- 列表能多选（同所有树），但 stash 那一行的菜单项和工具栏按钮都只认恰好选中一个 stash（同 IDEA 的 `GitSingleStashAction`）；多选后能做什么还没定（`product/backlog.md`）。文件的右键见下面「按文件取回」。
- 选中 stash 那一行，或者它下面的任何一个文件，都算选中了这条 stash。
- **一律按 hash 认 stash。** `git stash drop` / `pop` 只认 `stash@{n}`、不认 hash，而序号会随存、删而变，拿界面上的序号去删可能删错一条。所以 drop / pop / 改名在同一条本地道命令里，先按 hash 查出它现在的序号，再执行。`apply` 直接认 hash。
- Apply / Pop 不带 `--index`：取回后原来的暂存状态没了，全部变成未暂存。
- **Rename…**：git 没有改名，按 hash 找到现在的序号，先 `stash drop` 再 `stash store -m <新说明> <hash>`（提交本身不动，说明写在 reflog 上）。输入框标题 `Rename stash`，预填现在的说明并全选（同改分支名）；空着或没改就当作取消。说明原样写入，不加 `On main:`。`stash store` 总是加到 reflog 头上，改完这条排到最前。只改 reflog，不走进度出口，也不另确认。store 失败时这条已经不在列表里，提交还在，日志里有完整 hash，可以 `stash store` 找回来（和误删一样）。
- Delete 弹原生模态确认 `Delete the stash "…"? This cannot be undone.`，确认后状态栏用 git 的那句 `Dropped stash@{n} (<完整 hash>)`。真删错了，可以用日志里的完整 hash `git stash store` 找回。删除后**不**弹带 Restore 的通知（`product/never.md`）。
- 完成消息：Apply / Pop 是自己写的（`Applied …`、`Applied and dropped …`），因为 git 的输出是一整段 status。
- Apply、Pop 走进度出口；Delete、Rename 只改 reflog，立刻就能看到，不走。
- 取回时冲突：git 不删 stash（Pop 也一样），冲突文件显示在 Commit 面板的冲突组里（`product/features/conflicts.md`）；解决之后，stash 要自己删。

IDEA、VS Code git 都没有改已有 stash 的名字（IDEA 只在存的时候对话框里写说明）。GitLens 有 Rename Stash…，同样是 drop 再 store。

否决过：先 store 再 drop——同一 hash 会在列表里出现两次，按 hash 去删会删掉新的那条。

## 按文件取回

- stash 下的文件右键 **Apply Selected Files**：只取回选中的文件，stash 保留。展开看、全部严格：目录等于它下面列出的全部文件，都要属于同一条 stash；选中里含 stash 那一行时没有这一项，整条用那一行的 Apply。工具栏 Apply 仍取回整条。
- 已跟踪的、未跟踪的都能选；改名的两头一起取回（旧路径删掉、新路径出现）。
- 只有 Apply，没有按文件 Pop（同 IDEA：文件右键只有取回）。按文件 Pop 要重写那条 stash，在 `product/backlog.md`。
- 走进度出口 `Applying files from stash…`，完成消息 `Applied selected files from <说明>`。
- 冲突、被本地改动挡住都和整条 Apply 一样：和 HEAD 冲突时进冲突组，stash 留着；本地未暂存改动碰到同一文件时 git 拒绝，报它自己的那句。
- **做法**：git 没有按文件取回，所以拼一条只含选中文件的临时 stash，交给 `git stash apply`；冲突与挡住的处理就都是 git 的。临时提交不 `stash store`，不进列表。命令行见 `git/commands/stash.ts` 的 `applyStashFiles`。和上面「存」否决的「自己造 stash 提交再 `stash store`」不同：那条要重写 `git stash push`，这里只造一个给 `apply` 用的临时提交。

IDEA 在 stash 的文件右键有 `Cherry-Pick Selected Changes`（`Vcs.ApplySelectedChanges`，和 Log 详情的文件右键共用）：把选中的改动做成补丁，用自己的补丁引擎打上，打不上时弹自己的合并窗口。

否决过：
- `git restore --source=<stash> -- <路径>`：直接覆盖，本地改动丢掉，存完以后 HEAD 上的改动也被悄悄撤掉。
- `git diff <存时的提交> <stash> -- <路径> | git apply`：有一块对不上就整份失败，不留冲突标记；加 `--3way` 又要求文件和暂存区一致，有未暂存改动就报 `does not match index`（git 2.43 实测）。
- 照 IDEA 自己打补丁：打不上时要有自己的合并界面，我们没有（`product/backlog.md`「自建合并界面」）。
