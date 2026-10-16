# 第 11 阶段细节：Reword

状态：完成（2026-10-15）。核对清单逐条勾过；验收句手动走一遍；`pnpm check` 通过（637 个测试）。
验收句：提交右键 `Edit Commit Message…` 打开对话框（编辑器标签页），改一条提交的说明，点 Reword 后那条与它后面的提交在内存里重造，分支移过去，工作区不动。
（squash 等提交列表多选，2026-10-15 用户定，仍在池子。）

结束标志：`pnpm check` 通过，验收句手动走一遍成立，下面「要核对的条目」逐条勾过。

IDEA 的做法见 `refs/git4idea.md` §9.4～9.6。对话框的形态见 `tech/decisions.md`「自定义弹出窗口」。

## 零、要核对的条目

需求（`product/roadmap.md` 第 11 阶段）：
- [x] 改某一条历史提交的说明（reword）：入口只在能改的提交上出现（`rewordable` 有测试）；改写机制 7 条测试（含工作区不动、有合并提交拒绝）；handler 2 条（含操作停在半路时拒绝）

`tech/architecture.md`：
- [x] 第 21 题：reword 在内存里造提交（2026-10-15 改，`commands/reword.ts`）；第 4 题补上 `dummyGit.reword`

## 一、交互细节（逐条定）

1. **怎么改写：在内存里造提交**（已定，2026-10-15，改 tech/architecture.md 第 21 题）
   - 只改说明，每条提交的内容（tree）不变：从被改的那条到 HEAD，按顺序 `commit-tree <原 tree> -p <新父提交>` 重造一遍，最后 `update-ref HEAD <新> <旧>` 移动分支（detached 时移动 HEAD；效果同 `reset --soft`，多一道「读完之后 HEAD 没被动过」的检查，2026-10-15 第 1 步改）。不可能有冲突，不碰工作区与暂存区。
   - HEAD 也走这一套，不单用 `commit --amend`：只有一套机制。
   - 否决 `rebase -i --autostash` 加两个脚本：要写脚本（Windows 也得能跑）、会检出与 autostash、要走停下 / 继续 / 放弃；reword 用不上这些。drop、交互式 rebase 会真冲突，以后仍走 `rebase -i`。
2. **Squash：这一阶段不做**（2026-10-15 用户定）：要选一段提交，等提交列表多选，仍在池子。否决 `Squash Commits up to Here…`（这条到 HEAD 合成一条）。
3. **入口与能用的条件**（已定，2026-10-15）
   - 提交右键 `Edit Commit Message…`（IDEA 的叫法），在 `Reset Current Branch to Here…` 下面。
   - 只在这条提交位于 HEAD 的第一父提交链上、它到 HEAD（含它自己）都不是合并提交时出现，否则隐藏；Log 页面用骨架算出，写进右键菜单的上下文。根提交也能改，不另确认。
   - 有操作停在半路时菜单照样出现，扩展拒绝：`Cannot edit commit messages while <操作> is in progress.`（Log 不读进行中的操作，不为隐藏菜单去接）。
4. **对话框**（已定，2026-10-15）
   - 标题 `Edit Commit Message`，说明行 `<短 hash> on <分支>`（detached 时 `on HEAD`）；多行输入框预填原来的完整说明，可往下拉高；按钮 `Cancel` / `Reword`。
   - 内容为空或全是空白：点 Reword 没反应。没改：直接关，不改写。
5. **改写的细节**（已定，2026-10-15）
   - 作者与作者时间保留，提交者与提交时间是现在（同 `rebase`）。
   - 说明按 `git commit -F` 的默认规则整理（`git stripspace`：去行尾空白、合并连续空行、结尾补换行）。
   - 配了 `commit.gpgSign` 时给 `commit-tree` 加 `-S`（它不读这个配置）。不触发 commit-msg 钩子。
6. **做完之后**（已定，2026-10-15）
   - 点 Reword 就关标签页；状态栏 `Rewording…`，完成后 `Reworded <短 hash>`。
   - 不提醒已推送（同第 9 阶段 A.3）。不做带 Undo 的通知（用户定，也不进池子）。

## 二、实现顺序

每步一个概念，`pnpm check` 通过、手动看过、用户确认后单独提交。

1. **改写机制**（git 层）：`rewordCommit`——取被改的那条到 HEAD 的提交（tree、父提交、作者、说明），确认是一条直线，逐条 `commit-tree`，`update-ref` 移过去。说明经 `stripspace`，`commit.gpgSign` 时加 `-S`。
   测试：改 HEAD；改更早的一条，后面各条内容与作者不变、说明不变；工作区与暂存区的改动原样留着；中间有合并提交时拒绝。
2. **入口与对话框**：Log 骨架算出能改的提交，写进右键上下文；`Edit Commit Message…` 打开对话框（`DialogKind.Reword`，标签页的 subject 是 hash），预填说明，Cancel 关；Reword 点了没反应。
3. **Reword**：协议命令 `reword`，进行中的操作时拒绝；点了就关、走进度出口。手测场景 `reword`。
4. **验收**。

