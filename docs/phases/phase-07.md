# 第 7 阶段细节：会停在半路的操作

状态：完成（2026-10-13）。核对清单逐条勾过；验收句按各步手测走完；`pnpm check` 通过（548 个测试）。
验收句：merge、rebase（到分支或任意提交）、不能快进的拉取、cherry-pick、revert。停在半路时，冲突组的标题行写明是哪种操作，右边给继续和放弃；冲突文件用 VS Code 自带的合并编辑器解决。

结束标志：`pnpm check` 通过，验收句手动走一遍成立，下面「要核对的条目」逐条勾过。

## 零、要核对的条目

需求（`product/roadmap.md` 第 7 阶段）：
- [x] 分支右键：合并到当前分支、把当前分支 rebase 到它
- [x] 提交右键：rebase 到这条提交、cherry-pick、revert
- [x] 不能快进的拉取，分成「rebase 方式」和「merge 方式」两个入口（拉取遇分叉时通知里的两个按钮）
- [x] 停在半路时，冲突组的标题行写明是哪种操作停了，右边给继续和放弃；放弃按操作类型调对应的 abort
- [x] 停在半路时（merge、rebase、cherry-pick、revert），说明框预先填好 git 准备的说明
- [x] 冲突文件在 Commit 面板里单独成一组，没有复选框
- [x] 冲突文件用 VS Code 的合并编辑器打开
- [x] 没有进行中的操作、但有未合并的文件时（比如 stash 取出时冲突），同样显示冲突组
- [x] 冲突文件能标记为已解决；文件里还有冲突标记时先确认再标记；标记后移出冲突组
- [x] 一边删了、一边改了的冲突，不开合并编辑器，直接选「保留」或「删除文件」；两边都删了的只能删
- [x] 冲突组没清空时不能继续；继续时不自动把其它文件标记为已解决
- [x] Commit 面板文件的右键菜单接入；未跟踪文件右键 Add to Git（放进暂存区，不确认）、Delete（确认后从磁盘删掉）

`tech/architecture.md`：
- [x] 第 18 题：进行中的操作读状态文件，五选一（带 `kind`）；仓库的所有路径只从「仓库位置」一处来；`operation` 域过期时重读
- [x] 第 19 题：`_open.mergeEditor` + 只读文件系统的 `:1` / `:2` / `:3`；标记已解决只有一条路；冲突组来自 `git status` 的未合并条目
- [x] 第 10 题旁：`DiffSide` 加暂存区那种边
- [x] 第 15 题已知错误：拉取不能快进改为选 rebase 或 merge（推送被拒照旧报错）
- [x] 第 6 阶段推迟：要签名口令的 rebase / cherry-pick 照旧显示 git 的报错

## 一、交互细节（逐条定）

分两批：A 冲突处理的基础设施（第 4 阶段 Stash 取出冲突已经用得上），B 各操作的入口。

**A 批（已定，2026-10-10）**

1. **四种情况**。面板只问两件事：「有没有停下的操作」（看状态文件，tech/architecture.md 第 18 题）和「有没有冲突文件」（看 `git status` 的未合并条目）。组合出四种：
   ① 都没有：平常的样子。
   ② 只有冲突（比如 stash 取出冲突）：只显示冲突组，没有按钮。
   ③ 有停下的操作，也有冲突：标题行 + 冲突文件，继续不可点。
   ④ 有停下的操作，没有冲突：只有标题行，继续可点。
   由 webview `logic/` 里的一个纯函数算出，Vue 只负责显示。不管操作是谁发起的（终端里执行的 merge 也一样）。
2. **冲突组标题行**：
   ③ `Merging feature · 2 conflicts  [»] [×]`，» 不可点，悬停提示先解决冲突。
   ④ 组里没有文件，但标题行照常显示，» 可点并高亮。
   ② `Conflicts · 2`，没有按钮。
   » 用绿色，× 用红色，都取主题里的语义颜色。
3. **放弃先确认**，确认后执行对应操作的 abort。
4. **不自动继续**：最后一个冲突解决后只把 » 高亮，由用户自己点。
5. **Commit 与 Amend**：情况③④不可用，两者用同一个条件。勾选框不处理。情况②不受影响（实测 stash 冲突时用 `commit --only` 提交其它文件能成功）。
6. **说明框预填**：merge、cherry-pick、revert 从 `MERGE_MSG` 取，rebase 从 `rebase-merge/message` 取。
   进入③④的那一刻一起做三件事：Amend 取消勾选、Amend 与 Commit 锁住（第 5 条）、说明框直接覆盖成 git 准备的说明。
   写到一半的草稿不保存，覆盖了就丢了（用户定：写到一半去 merge 是少见情况，不值得为它多一份状态）。
   操作结束（继续成功或放弃）后清空说明框，同提交成功后。
7. **树组件的改动**（都在通用树组件里，每处几行）：
   ① `TreeNode` 能声明「没有复选框」，给冲突文件用（需求本来就要求）。
   ② `FileGroup` 加一个「空了也显示」的标记，给情况④用（现在空组在 `fileTree.ts:84` 被直接丢掉）。
   ③ `FileTree.vue` 把 `after` 插槽转交给 `Tree.vue`。
   ④ `Tree.vue` 的单击和双击处理，把插槽区域也排除在外（和复选框一样），否则点按钮会同时选中这一行并展开或收起。
   按钮靠右用 `margin-left: auto`。树的键盘导航是整行移动，按钮只能用鼠标点。

8. **合并编辑器**（tech/architecture.md 第 19 题不变）：三栏都取暂存区——基准 `:1`、左 Current `:2`、右 Incoming `:3`，输出是工作区的文件。
   五种冲突（merge、rebase、cherry-pick、revert、stash 取出）都把三栏写进暂存区，一条路；改名时各栏已是 git 对好路径的内容。
   否决 VS Code 自带 git 扩展的做法（左右取 `HEAD` / `MERGE_HEAD` 或 `REBASE_HEAD` 的提交）：要按操作分别找对方是哪个文件，cherry-pick、revert、stash 还得退回暂存区。
   栏的标题借它的写法：左 `Current` + 当前分支名；右 `Incoming` + merge 的对方分支名 / cherry-pick 与 revert 的短 hash / stash 冲突写 `Stashed Changes`（信息来自第 4 步读状态文件，不另跑命令）。
   rebase 时不对调左右，一律左 Current、右 Incoming，标题写清。冲突文件右键不做 Accept Ours / Theirs（需求池）。

**B 批（已定，2026-10-10）**

1. **分支右键：合并、rebase**。本地与远程分支都加 **Merge into Current**（`git merge <分支>`）、**Rebase Current onto This**（`git rebase <分支>`），
   在 `2_sync` 组、Pull 与 Push 后面；当前分支（含 HEAD 行）不出现。不弹确认（同 IDEA：出事了能放弃）。
2. **提交右键**：Copy Hash 下面一组 **Cherry-Pick**、**Revert**、**Rebase Current onto Here**。不弹确认。
3. **工作区有改动**：merge、cherry-pick、revert 交给 git（不冲突时带着改动做，冲突时 git 拒绝、显示原文）。
   rebase 加 `--autostash`；取回冲突时落到情况②（同 stash 冲突）。
4. **不能快进的拉取**：Pull 只有一个入口（竖按钮区的按钮与分支右键的 Pull 是同一条命令）。遇到分叉时弹原生通知，两个按钮 **Rebase** / **Merge**，
   对上游的远程分支记录执行 `rebase` / `merge`（前一步已取回，不再联网）。需求里的「两个入口」就是这两个按钮；不另加 Pull (Rebase)、Pull (Merge) 菜单项（用户定：和 Pull 按钮统一逻辑）。
5. **推送被拒**：这一阶段不做，照旧报错（用户定）。选 rebase 或 merge 后推送进了需求池。
6. **签名口令**：第 6 阶段推迟，要口令时照旧显示 git 的报错。

## 二、实现顺序

每步一个概念，`pnpm check` 通过、手动看过、用户确认后单独提交。前三步只做冲突处理，用 stash 取出冲突就能测。

1. **冲突组（情况②）**：`git status` 的未合并条目进 `Conflicts` 组（最上面），文件后灰字写冲突类型；树组件能声明「这个节点没有复选框」。
2. **合并编辑器**：只读文件系统与 `DiffSide` 加「暂存区某一栏」的边；双击冲突文件调 `_open.mergeEditor`。
3. **Commit 面板文件的右键菜单**：冲突文件 Open in Merge Editor ｜ Mark as Resolved（先查冲突标记）；删改冲突 Keep / Delete File；Changes 组 Rollback；未跟踪文件 Add to Git（`git add`，不确认）、Delete。
4. **停在半路的操作（情况③④）**：读状态文件（第 18 题）；冲突组标题行的继续与放弃（放弃先确认）；锁 Commit / Amend、覆盖说明框；合并编辑器的标题带上操作信息；树组件其余三处改动。
5. **分支右键**：Merge into Current、Rebase Current onto This（`--autostash`）。
6. **提交右键**：Cherry-Pick、Revert、Rebase Current onto Here。
7. **拉取遇到分叉**：通知里 Rebase / Merge。
8. **验收**：「要核对的条目」逐条勾过；验收句手动走一遍；`pnpm check`；本文状态改为完成。
