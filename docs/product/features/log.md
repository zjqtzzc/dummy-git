# Log 面板

> 底部的 Log 面板：三栏布局、提交列表、提交详情、过滤与搜索、高亮、复制、提交的右键菜单，以及为什么这样做。改 `webview/src/log/`、`logic/log/` 与相关的 git 命令前先读本文；行为变了就改本文。
> 左栏分支树见 `product/features/branches.md`；提交图与 ref 标签见 `product/features/graph.md`；右栏的文件树与打开 diff 见 `product/features/trees.md`。

## 面板与三栏

- 底部面板的视图容器标题 `Dummy Git`，里面一个视图 `Log`，图标是一个提交图形的简单 SVG。界面文字全部英文。
- 三栏：左边分支树、中间提交列表（上面是过滤栏）、右边是选中的提交（上面是它改了的文件，下面是详情）。宽度全用像素：左 240px、右 320px，中间占剩下的全部。拖动分隔线后的左右宽度存进 `setState`，收起再展开、重新加载窗口都会恢复；窗口大小变化时左右两栏宽度不变。
  - 实现：两层 `vscode-split-layout`，三条分隔线（连同下面右栏上下那条）都不设 `fixed-pane`，尺寸只记在我们自己的一份 `layout` 里（只在拖动时写）。每层尺寸一变，就按 `layout` 重摆这一层：左 `left px`，右「这一层宽度 − 右栏宽度」（组件的位置只能从左边算），上下按比例。只摆变了的那层：拖左边分隔线时内层跟着变宽，这时连外层一起摆会把正在拖的分隔线拽回去。比右栏还窄时组件压到 0，记下的宽度不变，窗口变宽后回来。
  - 否决 `fixed-pane`：它自己另记一份固定栏的宽度，面板收起时页面还在（`retainContextWhenHidden`）、只是缩成 0，它就把那份记成 0，再展开时右栏没了。GitLens 的 Graph 同样不信隐藏时的 0 尺寸（`graph-app.ts` 只记非零尺寸）。
- **右栏上下按比例分**（同 IDEA 的 `OnePixelSplitter`，比例 0.7）：默认文件占 70%，面板变高变矮时上下一起伸缩；拖过的比例存进 `setState`。否决固定详情的像素高度：左右栏固定宽度是为了让中间的提交列表吃掉多出的空间，右栏上下没有这个理由。
  - 实现：不设 `fixed-pane` 时组件不跟踪尺寸，内部记的分隔线像素位置和总尺寸都会过时，改过大小后一按分隔线就跳位；所以上面每次重摆都设 `handlePosition`（它会先重新量这一层的尺寸）。不能用 `resetHandlePosition()`：它只重算位置、不更新尺寸，比例会越拉越歪。

## 提交列表

- 三列：**Message** 只显示第一行；**Author** 只显示名字；**Date** 用作者时间：一小时以内写「多久之前」（`just now`、`5 minutes ago`），今天更早的写 `Today 11:23`，再早的写年月日加时分（`2026/9/20 15:51`）。所有显示时间的地方都是这一种写法（`logic/utils/time.ts`）。
- **列宽**：表头有两条分界线，一直显示（同 IDEA）。拖 Message|Author 只改 Author；拖 Author|Date 时两列此消彼长，Message 不动。拖过之后，把像素宽度存进 `viewState`；没拖过时用 CSS 的 `8em` / `9.5em`，跟着字号走。开始拖时先量表头的实际宽度，所以 em 和像素之间是无缝的。否决默认值也写成像素：就丢了跟字号缩放。否决 Author|Date 只改 Date：拖它时 Author 整列会跟着平移，手感不对。
- **最多一万条**，更早的不取（为什么是一万条见 `tech/architecture.md` 第 8 题）。第一万条附近的父提交不在列表里，提交图上那条线画到行底并渐隐。
- 先取骨架，看到哪几行再取那几行的详情（`tech/architecture.md` 第 8、9 题）；还没取到详情的行，三列先显示浅色占位。
- 虚拟滚动：行高固定 22px（同 VS Code 原生的列表），只渲染看得见的几十行。
- 打开时选中 HEAD 所在的提交并滚到它（第一行不一定是 HEAD）。
- **多选**（同 VS Code 原生列表、IDEA；规则在 `logic/selection.ts`，所有树也用这一套）：
  - 单击、↑↓ 只选这一行；Ctrl+单击（Mac 上 Cmd+单击）加选、减选；Shift+单击从锚点（最近一次单击或 Ctrl+单击的那行）选到这一行，替换原来的选中，Ctrl+Shift+单击把这一段加进去；Shift+↑↓ 锚点不动，范围伸缩一行；Ctrl+A 全选。否决 VS Code 的 Ctrl+↑↓ 加 Ctrl+空格：多出「光标所在的行没被选中」这种状态。
  - 光标所在行不加标记（同 IDEA）：多选几乎都用鼠标。
  - 不设上限（IDEA 只取前 1000 条）：列表本来最多一万条，批量命令走 stdin，没有长度限制。
  - Mac 上 Cmd+A 拦了按键，整页文字照样被选上（调试窗口实测）：列表行不可选文字，列表有焦点时出现选区就清掉。
  - 选中只在页面里，不存进 `viewState`。
- **刷新**（新提交、切换分支）：选中的提交还在列表里的留着，光标那行停在屏幕上原来的位置（上面多了新提交时视图不跳）；一条都不剩了就改选 HEAD 所在的提交。右栏只在选中变了时才重取。
- 首次加载时中间栏显示 `Loading…`；右栏取文件时也显示 `Loading…`。
- 选中多条时右栏上面写一行灰字 `3 commits selected`，下面的详情留空，不取文件；选中变回一条时照常取。照 IDEA 合并显示几条的改动在需求池。

## 提交详情

右栏下半部分，同 IDEA 的提交详情：
```
标题（加粗）
正文（照原样，保留换行）
1a2b3c4  Alice <alice@x.com>  2026/9/20 15:51
committed by Bob <bob@x.com>  2026/9/21 09:00     ← 灰色
```
- **标题**是说明的第一段（到第一个空行为止）；第一段本身有好几行时不算标题，整段说明都照正文排（同 IDEA）。不照 IDEA 按标题右边距折开长标题：自然换行就够了。
- **元信息**：短 hash、`名字 <邮箱>`（邮箱为空时只写名字）、作者时间。日期写绝对时间，和复制提交时同一种写法；不照 IDEA 的 `on … at …` 句式，界面别处都是短写法。
- **提交者一行**（灰色）：提交者和作者不是同一个人时写 `committed by …`；同一个人（名字和邮箱都相同）、只是时间不同（rebase、amend 过）时写 `committed <时间>`；都一样就没有这一行。
- 文字可以选中复制；长单词（URL、路径）在任意处折行。说明里的 hash、URL 不做成链接。
- 只用已经按 hash 取到的提交详情，不加 git 命令；没有选中、或详情还没取到时留空。
- 不显示这条提交上的分支和 tag（列表那一行已经有了），也不显示包含这条提交的分支（`product/backlog.md`）。

## 过滤与搜索

提交列表正上方一行，只占中间那栏（同 IDEA）：左边搜索框占满剩余宽度，右边 `Branch`、`User`、`Date`、`Paths` 四个按钮，最右边是 Graph Options（排序，`product/features/graph.md`「排序」）和 View Options（见下面「高亮」）。未生效时按钮只写名字，生效后写当前的值（`User: Me`），后面带 × 用来清除。中间栏变窄时，先缩搜索框，按钮文字不截断。

- **选值用 VS Code 原生的 QuickPick**（由扩展弹出，可搜索，键盘和主题都是原生的），选中的值交回页面，过滤状态由页面持有。以后换成按钮正下方的下拉菜单（`product/backlog.md`），到时只换弹框这一层。
- **分支**：单选。Branch 按钮弹出本地与远程分支；左栏双击分支效果一样（HEAD 那行是当前分支）。分支过滤是换骨架的起点、重取一万条。正在过滤的分支没了（在这里删、在外面删、fetch 时被 prune、存下的过滤在重开窗口时已不在），过滤自动清除，按全部分支重取，不报错（先取 refs 再取骨架，`tech/architecture.md` 第 8 题「加载顺序」）。
- **作者**：单选。第一项是 **Me**（git 配置里的 `user.name` 与 `user.email`），下面是这一万条里出现过的作者，按提交数从多到少排。按「名字 <邮箱>」整串、当作普通文字匹配（`--author` + `-F`），不用正则。
  - **全部走 mailmap**（2026-10-21 项目负责人定）：列表显示的作者、这里列出来的作者、`--author` 比的、Me（用 `git check-mailmap` 换算）都是 mailmap 之后的，同一个人用过的几个邮箱合成一项。`--author` 本来就按 mailmap 比（git 2.25、2.43 实测），命令里写死 `-c log.mailmap=true`，用户配置关掉了也不变。否决照 IDEA 全用原样：一个人会被拆成好几个。
- **日期**：`Last 24 Hours`、`Last 7 Days`、`Last Month` 三个预设，不做自定义。在页面里按骨架的时间筛，不问 git。
- **路径**：列出所有被跟踪的文件，以及由它们推出的目录，可搜索，单选；命中的规则同 `git log -- <路径>`（合并提交和每个父提交比都有改动才算），不跟改名（不加 `--follow`）。不用 `log --no-walk`，用 `diff-tree --stdin` 逐条和父提交比：git 2.55 起 `--no-walk` 不看路径（`tech/traps.md`），命令见 `git/parsers/log.ts` 的 `pathMatch`。IDEA 先查自己建的路径索引，没有索引时走历史：`git log <分支…> --full-history --simplify-merges -- <路径>`（`plugins/git4idea/backend/src/log/GitLogProvider.kt` 的 `getGitLogParameters`）。否决照 IDEA 走历史：匹配少时要走完全部历史，正是只在一万条里筛要避开的（`tech/architecture.md` 第 8 题）。
- **搜索框：说明文字或 hash**（同 IDEA 的「Text or hash」），两路结果取并集：
  - 说明文字：普通文字，不分大小写（`--grep` + `-F -i`）；
  - hash：输入是 4 个以上的十六进制字符时，也匹配以它开头的 hash（在页面里对骨架做）。4 是 git 缩写的最短长度，免得 `add`、`fix` 这类短词误中。
  - 停止输入一会儿才查（防抖，`LogApp.vue` 的 `SEARCH_DELAY_MS`）；查询进行中旧列表留着，不转圈：限在一万条里以后查得很快，转圈只会一闪（实测见 `tech/performance.md` §3）；只收最新那次查询的结果。
- **组合**：几种过滤取交集（同 IDEA）。过滤只在骨架那一万条里做：把这些 hash 从 stdin 喂给 git（说明文字、作者用 `git log --no-walk --stdin` 加上条件，路径见上面），一次一个条件，页面取交集。一万条以上的仓库上几种过滤都在 100 ms 以内（`tech/performance.md`）。
- 过滤后，原来选中的提交还在列表里的留着，一条都不剩就清空选中；分支过滤照骨架刷新的规则。没有结果时正中一行灰字 `No commits match the filters`。仓库变化时自动重查。过滤条件存进 `viewState`。
- 筛选时提交图怎么画，见 `product/features/graph.md`。

## 高亮

全部提交都留着，只改样式，让几类提交一眼认得出来（同 IDEA 的 Highlight，2026-10-21 项目负责人提）。IDEA 的做法在 `.notes/rebased-master` 里核对过，`platform/vcs-log/impl/src/com/intellij/vcs/log/` 下的文件省略这个前缀。

- **三种，各管一样**（规则在 `logic/log/highlight.ts`）：
  - **My Commits**：我的提交，作者那一列加粗（同 IDEA 新界面，`ui/highlighters/VcsLogCommitsHighlighter.java:48`）。「我」和 User 过滤的 Me 同一口径、都走 mailmap（见上面「作者」）：`getIdentity` 换算过的「我」与详情的作者，名字和邮箱都相等才算。没配 `user.name` 时没有「我」。否决照搬 IDEA 的宽规则（名字不分大小写、邮箱 `@` 前那段等于名字也算，`data/VcsLogUserResolver.kt`）：过滤和高亮会对不上。
  - **Merge Commits**：父提交两个及以上，三列文字变灰（`--vscode-disabledForeground`）。
  - **Current Branch**：HEAD 包含的提交带一层浅蓝（`--vscode-charts-blue` 按 12% 混进透明）。HEAD 游离也照样涂（同 IDEA：游离时当前分支取 `HEAD`）。
- **一直生效**（2026-10-21 项目负责人定）：不做 IDEA 的自动关闭（只有一个作者、按 Me 过滤时不加粗；按当前分支过滤时不涂，`ui/highlighters/CurrentBranchHighlighter.java:49-57`）。按当前分支过滤时整列都涂。否决照 IDEA：同一个开关会因过滤条件不同而时灵时不灵。
- **怎么叠**：三种各管背景、文字颜色、字形，互不冲突，全叠上。**选中的行只用选中色**，浅蓝和灰字让给它，加粗照旧（同 IDEA：选中时底子是选中色，涂背景、变灰的高亮器在选中时不给值，`ui/table/VcsLogGraphTable.java:765`、`:936-940`）。浅蓝是半透明的一层画在背景色之上，悬停时悬停色从下面透上来，还看得出浅蓝。
- **Current Branch 怎么算**：IDEA 的底图永远是全部分支的完整图，过滤只决定显示哪些行，所以从 HEAD 往下走就行（`data/CurrentBranchConditionCache.kt:46-56`）。我们按分支 B 过滤时骨架换成 B 的历史，里面未必有 HEAD，所以起点由扩展给（`getHeadBases`，`git merge-base --all HEAD <骨架的起点>`）：不按分支过滤时就是 HEAD；按 B 过滤时是 HEAD 与 B 的合并基点，B 的祖先里 HEAD 也包含的正好是它们往下的全部，和 IDEA 涂出来的同一批；没有共同祖先（孤儿分支）时一条都不涂。页面从起点沿全部父提交在骨架里往下走，走出骨架就停。起点在取过 refs 之后和骨架并行取（`tech/architecture.md` 第 8 题「加载顺序」），HEAD 一变 refs 就过期，起点跟着重取。耗时见 `tech/performance.md` §2.2。否决按别的分支过滤时不涂：又成了自动关闭。否决把 HEAD 也拉进骨架：骨架就不再只是 B 的历史，一万条的名额也被分走。
- **View Options**：过滤栏最右边的眼睛按钮（`AppIcon.ViewOptions`，旧插件的 `ViewOptionsIcon` 搬过来的线条图标；IDEA 用的是 `AllIcons.Actions.GroupBy`），是有选单的图标按钮（`ui/MenuButton.vue`，`product/features/menus.md`）：点开是贴着按钮的浮层选单，一节标题 `Highlight`，下面 `My Commits`、`Merge Commits`、`Current Branch` 三个勾选项，勾一下马上生效，选单不收起。IDEA 是工具栏右上角弹出菜单里的 Highlight 一节（`platform/vcs-log/impl/resources/intellij.platform.vcs.log.impl.xml:257-269`）。以后有别的显示选项再往里加；否决三个开关各占一个按钮：过滤栏放不下。
- 开关存进 `viewState`，存的是**关掉的**那几种：以后新加的默认开（同 IDEA：没存过的高亮取 `true`，`impl/VcsLogUiPropertiesImpl.kt:30`）。落盘的字符串走映射表，认不出的当作没有。

## 复制

- 提交列表上 Ctrl+C（Mac 上 Cmd+C），同 IDEA：选中的每条提交一行，`说明的第一行 作者名字 2026/9/20 09:05`，用空格隔开；多选时按列表顺序一行一条（2026-10-19 项目负责人定：一条一行，贴一串提交更好看。否决每条都带完整说明：贴出来又长又散）。日期写绝对时间：贴出去的文字不该写「5 minutes ago」。
- 提交行右键 **Copy Hash**：完整 hash；多选时按列表顺序一行一个（项目负责人定：多选的复制都一行一个，否决 IDEA 的空格隔开）。

## 提交的右键菜单

| 组 | 菜单项 | 见 |
|---|---|---|
| 1 | Copy Hash | 上面 |
| 2 | Cherry-Pick、Revert、Rebase onto Here | `product/features/conflicts.md` |
| 3 | Reset Current Branch to Here…、Edit Commit Message… | `product/features/history.md` |

`Edit Commit Message…` 只在能改的提交上出现，见 `product/features/history.md`。

**多选时**（菜单项怎么算见 `tech/decisions.md`「右键菜单：每个菜单项一个键」，提交列表的定义在 `logic/log/commitMenu.ts`）：Copy Hash、Cherry-Pick、Revert 作用于全部，其余只能对一条做的不出现。Cherry-Pick 从旧到新、Revert 从新到旧（同 IDEA），按列表顺序算，不按点选的先后。选中里有合并提交时没有 Cherry-Pick、Revert（只选一条时照旧交给 git 拒绝），原因见 `product/features/conflicts.md`。菜单文字不随条数变。
