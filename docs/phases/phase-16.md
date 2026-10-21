# 第 16 阶段细节：Log 高亮

状态：定细节中（2026-10-21）。
<!-- 之后依次改成：实现中 → 实现完，待手动验收（`pnpm check` 通过，N 个测试）→ 完成。完成后并进 product/features/ 并删掉本文（process/workflow.md §2）。 -->
验收句：提交列表里，我的提交作者加粗，合并提交文字变灰，当前分支上的提交带一层浅色背景；过滤栏右边的按钮能分别开关这三种。

结束标志：`pnpm check` 通过，验收句手动走一遍成立，下面「要核对的条目」逐条勾过。

## 要解决什么问题

提交列表一长，有几类提交想一眼认出来，又不想把别的过滤掉：哪些是我写的、哪些是合并提交（多半可以略过）、哪些已经在当前分支上了。过滤是把不要的藏起来；高亮是全留着，只改样式。

## 零、要核对的条目

需求（`product/roadmap.md` 第 16 阶段）：
- [ ] 我的提交：作者加粗
- [ ] 合并提交：文字变灰
- [ ] 当前分支上的提交：浅色背景；按别的分支过滤时也对
- [ ] 过滤栏右边的 View Options 按钮，分别开关三种，开关存进 `viewState`

`tech/architecture.md`：没有这个阶段第一次用到的题目（取数仍是第 8 题的骨架，样式在页面里算，同第 22 题）。

## 一、交互细节（逐条定）

IDEA 的做法都在 `.notes/rebased-master` 里核对过，`platform/vcs-log/impl/src/com/intellij/vcs/log/` 下的文件省略这个前缀，别处的写全路径。

1. **三种高亮，一直生效**（已定，2026-10-21 项目负责人定）
   - My Commits、Merge Commits、Current Branch，默认都开（同 IDEA：`impl/VcsLogUiPropertiesImpl.kt:30`，没存过的高亮器取 `true`）。
   - 不做 IDEA 的自动关闭：仓库只有一个作者、正按 Me 过滤时 IDEA 不加粗（`ui/highlighters/VcsLogCommitsHighlighter.java:72`）；正按当前分支或 HEAD 过滤时 IDEA 不涂背景（`ui/highlighters/CurrentBranchHighlighter.java:49-57`）。我们照样加粗、照样涂，整列都涂也照涂。否决照 IDEA：同一个开关会因为过滤条件不同而时灵时不灵。
   - 不做 Not Cherry-Picked Commits（IDEA 的 `plugins/git4idea/backend/src/branch/CherryPickedCommitsHighlighter.kt`，选一个分支后用 `git cherry` 比较）：留在需求池。

2. **样式怎么叠**（已定，2026-10-21）
   - 三种各管一样，互不冲突：Current Branch 管背景，Merge Commits 管文字颜色，My Commits 管字形。IDEA 的合并规则是每样取第一个给出值的（`VcsCommitStyleFactory.combine`），各管一样时等于全部叠上。
   - **选中的行用选中的背景色和文字颜色**，浅色背景和灰字都让给它；加粗照旧（同 IDEA：`ui/table/VcsLogGraphTable.java:765` 先取底子，选中时底子就是选中色，`:936-940`；涂背景、变灰的高亮器在选中时不给值，`CurrentBranchHighlighter.java:38`、`MergeCommitsHighlighter.java:25`；加粗的不看选中，`VcsLogCommitsHighlighter.java:43-51`）。
   - **鼠标悬停**：带浅色背景的行悬停时还看得出浅色（IDEA 在高亮背景上算悬停色，`VcsLogGraphTable.java:814-818`）。我们的做法：浅色背景是半透明的一层，画在悬停背景之上（`background-image`），悬停色从下面透上来。

3. **My Commits：作者那一列加粗**（已定，2026-10-21）
   - 只加粗作者列，同 IDEA 新界面（`VcsLogCommitsHighlighter.java:48`：作者列看得见时，别的列不加粗）。我们的作者列总是看得见。
   - **「我」是谁，和 User 过滤的 Me 用同一条规则**：作者那一行的原样（不走 mailmap）整串匹配「名字 <邮箱>」（`--author` + `-F`）。过滤出来的和加粗的是同一批。IDEA 的高亮与 Me 过滤也共用一个函数（`data/VcsLogUserResolver.kt` 的 `resolveCurrentUser`），只是它的规则更宽：名字不分大小写、邮箱 `@` 前那段等于名字也算。否决照搬 IDEA 的宽规则：过滤和高亮会对不上。
   - **待定**：怎么算出「我的」那一批。
     - 推荐：直接跑一次 Me 过滤那条命令（骨架那一万条 `git log --no-walk --stdin --author=… -F`），得到 hash 集合。规则天然和过滤一模一样；一万条以上的仓库上在 100 ms 以内（`tech/performance.md`），骨架变了才重跑。
     - 另一种：页面拿到「我」，和按需取到的详情比。但详情里的作者走了 mailmap（`%aN`），Me 过滤比的是原样（`%an`），有 `.mailmap` 的仓库上两边会对不上。
   - 没配 `user.name` 时没有「我」，不加粗。

4. **Merge Commits：父提交两个及以上，文字变灰**（已定，2026-10-21）
   - 同 IDEA（`MergeCommitsHighlighter.java:26`）。父提交骨架里就有，页面自己算。
   - 颜色用 `--vscode-disabledForeground`，三列都灰。

5. **Current Branch：从 HEAD 能走到的提交，浅色背景**（已定，2026-10-21）
   - 回答的问题：这条提交是不是已经在我现在检出的东西里。
   - IDEA 怎么做：底图永远是全部分支的完整提交图，过滤只决定显示哪些行；取当前分支（HEAD 游离时取 `HEAD`，`plugins/git4idea/backend/src/log/GitLogProvider.kt:338-339`；HEAD 算作分支类型的 ref，`plugins/git4idea/backend/src/log/GitRefManager.kt:272`），在完整底图上从它往下走，走到的收进一个集合（`data/CurrentBranchConditionCache.kt:46-56`，`platform/vcs-log/graph/src/com/intellij/vcs/log/graph/impl/facade/PermanentGraphImpl.kt:141`），在后台线程算，算完之前一条都不涂。
   - 我们的不同：分支过滤换的是骨架本身（`product/features/graph.md`），按别的分支 B 过滤时骨架里可能没有 HEAD，从 HEAD 走不通。
   - **做法：起点由扩展随骨架一起给，页面从起点往下走。**
     - 起点是 `git merge-base --all HEAD <骨架的起点>`；不按分支过滤时骨架的起点就写 HEAD，结果就是 HEAD 本身。
     - 按 B 过滤时：B 的祖先里从 HEAD 能走到的，恰好是 HEAD 与 B 的共同祖先；这几个合并基点往下走正好覆盖它们，和 IDEA 涂出来的是同一批。B 就是当前分支时，起点就是 HEAD，整列都涂（第 1 条）。
     - HEAD 游离时照样从 HEAD 走（同 IDEA）。仓库还没有提交时没有起点，一条都不涂。
     - 页面在 `logic/log/` 里用纯函数从起点沿父提交往下走，只在骨架里走；一万条以外的不在骨架里，走到就停，那些本来也不显示。不照 IDEA 放后台：骨架最多一万条，预计走一遍很快（实现时实测，写进 `tech/performance.md`）。
     - 刷新不另管：HEAD 一变（提交、切换、reset），refs 过期，骨架重拉，起点跟着骨架来。骨架没变时沿用旧数组，走出来的也沿用。
     - 作者、说明、日期、路径过滤只是在骨架上取交集，不影响走出来的结果。
     - 否决「按别的分支过滤时不涂」：等于又是自动关闭（第 1 条）。否决按别的分支过滤时把 HEAD 也拉进骨架：骨架就不再只是 B 的历史，一万条的名额也被 HEAD 那边分走。
   - 颜色：`--vscode-charts-blue` 按 12% 混进透明（`color-mix`），亮、暗主题都看得出；实现时在亮暗主题各看一眼再定比例。

6. **View Options 按钮**（已定，2026-10-21）
   - IDEA：Log 工具栏右上角一个按钮（`AllIcons.Actions.GroupBy`），点开是弹出菜单，前面是显示选项，隔一条线是 **Highlight** 一节，每种高亮一个勾选项（`platform/vcs-log/impl/resources/intellij.platform.vcs.log.impl.xml:257-269`，`ui/actions/HighlightersActionGroup.java`）。
   - 我们：过滤栏最右边一个图标按钮，提示文字 `View Options`，图标用 codicon `eye`。点开是 VS Code 原生的多选 QuickPick（`canPickMany`），标题 `Highlight`，三项 `My Commits`、`Merge Commits`、`Current Branch`，勾着的就是开着的。和过滤选值一样由扩展弹、结果交回页面，状态由页面持有，存进 `viewState`。
   - 现在只有 Highlight 这一节；以后有别的显示选项再往里加。否决三个开关各占一个按钮：过滤栏放不下。

## 二、实现顺序

每步一个概念，`pnpm check` 通过、手动看过、项目负责人确认后单独提交。

1. **骨架带上起点**（第 5 条）：`getSkeleton` 的结果加上「从 HEAD 能走到的起点」。测试：不过滤时是 HEAD；按另一个分支过滤时是合并基点（含有两个合并基点的情况）；按当前分支过滤时是 HEAD；空仓库没有。实测 `merge-base` 的耗时。
2. **算出每行的高亮**（第 2、4、5 条）：`logic/log/` 里从起点往下走、认出合并提交，合成每一行的样式（背景、灰字、加粗）。测试：走的范围、骨架外停下、合并提交、三种开关。实测一万条走一遍的耗时。
3. **提交列表画出来**：Current Branch 与 Merge Commits 两种；选中、悬停的样子（第 2 条）。调试场景 `log-highlight`：有合并、有当前分支外的提交、HEAD 游离可切。
4. **My Commits**（第 3 条，先定「待定」那一处）。测试：有 `.mailmap` 时加粗的和 Me 过滤出来的是同一批。
5. **View Options 按钮**（第 6 条）：多选 QuickPick，开关存进 `viewState`。
6. **验收**：「要核对的条目」逐条勾过；验收句手动走一遍；并进 `product/features/log.md`，删掉本文。
