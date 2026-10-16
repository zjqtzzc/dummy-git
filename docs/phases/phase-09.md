# 第 9 阶段细节：改写历史

状态：完成（2026-10-15）。核对清单逐条勾过；验收句手动走一遍；`pnpm check` 通过（616 个测试，在 VS Code 终端里跑要去掉继承的 `GIT_ASKPASS`，见 `tech/traps.md`）。
验收句：reset（soft / mixed / keep / hard，撤销最近几次提交也用它），二次确认。
（2026-10-15 缩小：reword、squash、fixup、force push 要自定义弹出窗口，drop 暂缓，都进池子。）

结束标志：`pnpm check` 通过，验收句手动走一遍成立，下面「要核对的条目」逐条勾过。

IDEA 的做法见 `refs/git4idea.md` §9，下文引用时写「IDEA §9.x」。

## 零、要核对的条目

需求（`product/roadmap.md` 第 9 阶段）：
- [x] reset 到某条提交：soft / mixed / keep / hard，都要二次确认（原生模态框即确认；`resetTo` 四种做法与 Keep 被拒有测试）
- [x] 撤销最近一次提交，改动留在工作区（由 Reset → Soft 覆盖，见 A.2）
- [x] 把最上面几条提交弹出去，改动留在工作区（同上）

`tech/architecture.md`：
- [x] 第 21 题中的「reset 类是一条 `git reset`」（`commands/reset.ts`）。rebase 类（reword / squash / fixup / drop）随池子推迟

## 一、交互细节（逐条定）

只剩 A 批：一条 `git reset` 就能做完的（reset、撤销、弹出）。
reword、squash、fixup、force push、drop 移进池子（用户 2026-10-15 定：IDEA 靠弹窗解决的，我们大概率也要用弹窗，等有了再做；force push 随推送对话框；fixup 归交互式 rebase，IDEA 把这块包成三个功能：编辑说明、合并提交、交互式 rebase，都靠弹窗；drop 不靠弹窗，用户定暂缓，草案见下）。

**A 批**

1. **Reset**（已定，2026-10-14，照 IDEA §9.2）
   - 提交右键 `Reset Current Branch to Here…`，任意提交都可选（不要求在当前分支上）。
   - 模态对话框，标题写「把当前分支（或 detached 时的 HEAD）reset 到 短 hash + 说明首行」，正文四行说明，按钮从轻到重：`Soft` / `Mixed` / `Keep` / `Hard`（+ 取消）。对话框即二次确认，Hard 不再追问。
   - 说明文字照 IDEA：Soft「Files won't change, differences will be staged for commit.」；Mixed「Files won't change, differences won't be staged.」；Keep「Files will be reverted to the state of the selected commit, but local changes will be kept intact.」；Hard「Files will be reverted to the state of the selected commit. Warning: any local changes will be lost.」
   - 一条 `git reset --soft|--mixed|--keep|--hard <hash>`。Keep 遇到保不住的本地改动时 git 拒绝执行，显示 git 的报错。不预先 stash。
   - 按钮顺序按「对文件的影响从小到大」，不按 IDEA 的枚举顺序（Soft/Mixed/Hard/Keep）：Keep 介于「不动文件」与「全丢」之间。模态框不能预选，不记上次的选择。
   - 否决 Hard 再追问一次（用户定：说明里已写明会丢改动，同 IDEA）。
   - 「取消」的位置由 VS Code 的原生对话框按平台排（macOS 上四个按钮时会落在中间），扩展控制不了。否决改用 QuickPick（用户定，2026-10-15）。
2. **撤销 / 弹出：不单设入口，用 Reset → Soft**（已定，2026-10-15）
   - 撤掉最上面 N 条 = 右键第 N+1 条 → Reset → Soft，改动留在工作区（已暂存）。
   - 否决 `Undo Commits up to Here…`（`reset --soft <X 的父提交>`）：与 Reset Soft 是同一条命令，只差「点要撤的那条还是点要留的那条」。
   - 否决 IDEA 式 Undo Commit（只撤 HEAD、把说明填回 Commit 面板）：它独有的只是填回说明；「漏了文件」用 Amend 就行，说明自动带出。因此也不做「扩展 → Commit 面板填说明」的事件。
3. **改写已推送的提交：改写操作本身不管**（已定，2026-10-15）
   - 改写后分支落后 / 分叉于远程，与「别人先推了」是同一种状态，归推送与 Update 处理，reset 不查、确认框不加提醒。
   - 否决确认框提醒「N 条已推送」、否决照 IDEA 设受保护分支禁用改写（用户定）。
   - 改写造成的与远程不一致完全交给用户自己解决：推送被拒的提示（「Update it first」）不为改写场景调整，被拒后也不引导去 force push（用户定）。force push 随推送对话框进池子。

**已移进池子的草案**

1. **Drop**（2026-10-15 定过交互后暂缓）
   - 提交右键 `Drop Commit…`，只删单条；原生模态确认「Drop 短 hash + 说明首行? Its changes will be lost.」。
   - 单条用 `rebase --autostash --onto <X 的父提交> <X>`，不必 `rebase -i` 加脚本。后面的提交依赖 X 时停在冲突，进第 7 阶段的冲突组。
   - 只在 X 位于当前分支第一父提交链上、X 到 HEAD 之间（含 X）没有合并提交、X 不是根提交时出现；不满足就隐藏（沿用现有右键菜单靠 `when` 隐藏的做法）。
   - 否决本阶段做多选删除（用户定：各列表的多选统一进池子，以后一起做）。

## 二、实现顺序

每步一个概念，`pnpm check` 通过、手动看过、用户确认后单独提交。

1. **Reset**：提交右键 `Reset Current Branch to Here…`；原生模态框四个按钮（Soft / Mixed / Keep / Hard，附说明）；一条 `git reset --<模式> <hash>`。
   测试：四种模式各自对 HEAD、暂存区、工作区的影响；Keep 遇到保不住的本地改动时 git 拒绝、什么都不动。
   手测场景 `reset`：几条提交，另有已暂存与未暂存的本地改动（`process/manual-testing.md` 的场景表一起更新）。
2. **验收**：「要核对的条目」逐条勾过；验收句手动走一遍；`pnpm check`；本文状态改为完成。
