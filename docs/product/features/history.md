# 改写历史：Reset 与改提交说明

> Reset 到某条提交、改某条历史提交的说明，以及为什么这样做。改这块的行为或相关代码前先读本文；行为变了就改本文。
> 照 IDEA（`refs/git4idea.md` §9，下文写作「IDEA §9.x」）。入口都在提交的右键菜单（`product/features/log.md`）。

## 共同的

- **改写操作本身不管「是否已经推送」**：改写之后，分支落后或分叉于远程，和「别人先推了」是同一种状态，交给推送和 Update 去处理。确认框里不加提醒；推送被拒的提示也不为改写的场景调整，不引导去 force push（项目负责人定）。否决照 IDEA 设受保护分支、禁止改写。
- 不做带 Undo 的通知（`product/never.md`）。

## Reset

（IDEA §9.2）
- 提交右键 `Reset Current Branch to Here…`，任意提交都能选，不要求在当前分支上。
- 原生模态框，标题 `Reset <当前分支（detached 时为 HEAD）> to <短 hash> "<说明首行>"?`，下面四行说明，按钮从轻到重：`Soft` / `Mixed` / `Keep` / `Hard`，另有取消。**对话框本身就是二次确认**，Hard 不再追问：说明里已经写明会丢改动（项目负责人定，同 IDEA）。
- 说明照 IDEA：
  - Soft：Files won't change, differences will be staged for commit.
  - Mixed：Files won't change, differences won't be staged.
  - Keep：Files will be reverted to the state of the selected commit, but local changes will be kept intact.
  - Hard：Files will be reverted to the state of the selected commit. Warning: any local changes will be lost.
- 一条 `git reset --soft|--mixed|--keep|--hard <hash>`。Keep 遇到保不住的本地改动时，git 拒绝执行，显示 git 的报错，什么都不动。不预先 stash。
- 按钮按「对文件的影响从小到大」排，不按 IDEA 的枚举顺序（Soft / Mixed / Hard / Keep）：Keep 介于「不动文件」和「全丢」之间。模态框不能预选，也不记上次的选择。「取消」的位置由 VS Code 的原生对话框按平台排（macOS 上有四个按钮时会落在中间），扩展控制不了；否决改用 QuickPick（项目负责人定）。
- **撤销最近几次提交，不单设入口，用 Reset → Soft**：要撤掉最上面 N 条，就右键第 N+1 条 → Reset → Soft，改动留在工作区（已暂存）。
  - 否决 `Undo Commits up to Here…`：和 Reset Soft 是同一条命令，只差「点要撤的那条」还是「点要留的那条」。
  - 否决 IDEA 式的 Undo Commit（只撤 HEAD，把说明填回 Commit 面板）：它独有的价值只是填回说明；漏了文件用 Amend 就行，说明会自动带出来。

## 改提交说明（Reword）

**入口**：提交右键 `Edit Commit Message…`（IDEA 的叫法），在 `Reset Current Branch to Here…` 下面。
- 只在这条提交位于 HEAD 的第一父提交链上、并且它到 HEAD（含它自己）都不是合并提交时出现，否则隐藏。Log 页面用骨架算出能改的提交（`logic/log/rewordable.ts`），写进右键菜单的上下文。根提交也能改，不另外确认。
- 有操作停在半路时，菜单照样出现，由扩展拒绝：`Cannot edit commit messages while a merge is in progress.`（还有 a rebase / a cherry-pick / a revert）。Log 不读进行中的操作，不为了隐藏菜单去接它。

**对话框**（外壳见 `product/features/dialogs.md`）
- 标题 `Edit Commit Message`，说明行 `<短 hash> on <分支>`，detached 时 `on HEAD`。
- 多行输入框，预填原来的完整说明，12 行高，可以往下拉高。按钮 `Cancel` / `Reword`。
- 内容为空或全是空白时，点 Reword 没反应；没改过，就直接关掉，不改写。
- 点 Reword 就关掉标签页，改写在后台跑：状态栏 `Rewording…`，完成后 `Reworded <短 hash>`。提交已经不在那条直线上时：`Cannot edit the message of <短 hash>: it is not on the current branch, or a merge commit comes after it.`

**在内存里造提交**
- 只改说明，每条提交的内容（tree）都不变：从被改的那条到 HEAD，按顺序 `git commit-tree <原 tree> -p <新父提交>` 重造一遍，最后 `git update-ref -m reword HEAD <新> <旧>` 把分支移过去（detached 时移动 HEAD）。效果同 `reset --soft`，但多一道检查：读完之后 HEAD 有没有被别人动过。不可能有冲突，也不碰工作区和暂存区。
- HEAD 那条也走这一套，不单独用 `commit --amend`：只有一套机制。
- 作者和作者时间（含时区）原样保留，提交者和提交时间是现在（同 `rebase`）。
- 新说明按 `git commit -F` 的默认规则整理（`git stripspace`：去掉行尾空白、合并连续空行、结尾补换行）。
- 配了 `commit.gpgSign` 时，给 `commit-tree` 加 `-S`：它不读这个配置。不触发 commit-msg 钩子。
- 否决 `rebase -i --autostash` 加两个脚本：要写脚本（Windows 也得能跑），会检出、会 autostash，还要走停下 / 继续 / 放弃，reword 一样都用不上。drop、交互式 rebase 会真的冲突，以后仍走 `rebase -i`（`tech/architecture.md` 第 21 题）。
