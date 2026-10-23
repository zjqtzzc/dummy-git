# 需求池

> 以后可能做、还没排进阶段的需求，按功能分组，组名和 `product/features/` 一一对应。排进阶段时从这里移到 `product/roadmap.md`；决定永远不做的移到 `product/never.md`；做完了就删掉。
> 先后由项目负责人定，定了的移到组的最前面并标「下一批」。标「大」的是要单独成一个阶段的工程。

## 跨功能

- 多选以后还能做的（列表多选本身第 14、15 阶段已做完）：提交列表批量 drop、squash（见「改写历史」）；Stash 多选后能做什么（还没想好）；Log 右栏文件多选后的菜单项（要先有单个文件的 Revert / Apply 等，见「Log」）。
- 提示文字统一处理：现在各处直接显示 git 原文（少数已知错误自己写了一句）。以后集中成一处：一张「情况 → 文案」的表，或者让错误出口从 git 原文里挑出有用的那一行（跳过 `To …`、`hint:`，优先 `error:` / `fatal:`），顺带统一语气。
- 多仓库批量 fetch / pull / push。现在只支持单仓库（`tech/architecture.md` 第 13 题）。

## Log（`product/features/log.md`）

- 提交详情里显示「包含这条提交的分支」（同 IDEA 的 `In 3 branches: …  Show all`）：要新加 `for-each-ref --contains`，大仓库上可能要几秒，得异步加载（第 13 阶段定不做）。
- 跳到 hash 或 ref（Go to）：列表滚到那一行并选中，其它提交都还在；被过滤掉了、或在一万条以外时，说明原因。
- 过滤栏的四个按钮改成在按钮正下方弹出的下拉菜单：现在用原生 QuickPick 过渡，到时只换弹框这一层，过滤逻辑不动。浮层的定位与收起可以复用 `ui/PopupMenu.vue`（`product/features/menus.md`）；分支、作者、路径的列表很长，还要加搜索框、只画看得见的几行。
- 图形选项的其余几项（排序方式在第 18 阶段）：只看第一个父提交（First Parent）、隐藏合并提交。不影响架构：隐藏合并提交是在骨架上按父提交个数筛；First Parent 是骨架命令多一个参数。
- 提交图建在内存里（IDEA 的做法，2026-10-22 项目负责人要求记下）：IDEA 把全部提交读进内存建成完整的图，排序（IntelliSort：合并进来的那一支紧挨着排在合并提交下面）、过滤都在这张图上算，切换不重跑 git。我们现在每次让 git 排好再取骨架，`Topologically` 用的是 git 的 `--topo-order`，和 IntelliSort 不完全一样。要做到一样、或要切换更快时，迁到内存。
- 区间过滤（`branchA..branchB`）。
- 搜索框的正则开关、大小写敏感开关。
- 合并提交：可以切换着看相对每个父提交的改动。
- 提交列表多选时，右栏合并显示（同 IDEA，2026-10-19 项目负责人定要做，排在提交列表多选之后）：文件区把选中各条的改动按文件合并成一份，每个文件的 diff 是「选中里最早改它的那条之前」对「最晚改它的那条之后」；详情区逐条列出（IDEA 最多 50 条）。IDEA 的做法：`VcsLogUtil.collectChanges` 从旧到新收齐各条的改动，`CommittedChangesTreeBrowser.zipChanges` 按路径合并；改动的文件太多时先显示条数，点了才展开（`VcsLogAsyncChangesTreeModel.kt` 的 `ManyDetails`）。
  难度中等，约三步：取文件的命令改成一次收多个 hash（一条 `git log --no-walk --name-status`）；按路径合并的纯函数，难在改名链（`a→b` 又 `b→c`）、选中里先加后删、选得不连续时中间没选的那条也改过这个文件（IDEA 源码注释承认只做到「够用」）；右栏接上，加文件太多时的上限。diff 的两边用现成的「某个提交里的文件」就能表达，`openDiff` 不用改。
- 提交详情里对文件：Revert Selected Changes（从这条提交撤销这几个文件的改动）、Cherry-Pick Selected Changes、Apply Selected Changes（把这几个文件的改动应用到工作区）。

## 提交图（`product/features/graph.md`）

- 长线显示开关：现在总是隐藏长线的中间，打开开关后画全。
- HEAD 所在提交的节点画成「外圈 + 实心」，标出当前位置（同 IDEA）。
- 键盘导航：列表上下移动，沿着图在父子提交之间左右跳。

## 分支（`product/features/branches.md`）

- 检出远程分支时，同名本地分支和它分叉了：照 IDEA 让用户选「把本地 rebase 到远程上」还是「丢弃本地、用远程的」。
- 分支树上方的搜索框，过滤分支。
- 收藏 / 星标分支（置顶或单独分组）。当前分支同时被收藏时，黄色标签图标变成实心。

## 同步（`product/features/sync.md`）

- 推送被拒时给 Rebase & Push / Merge & Push：fetch → rebase 或 merge → 没冲突就推送；中途冲突停下，就不再自动推送。现在推送被拒只报错。
- 提交右键 `Push All up to Here…`：推到某条历史提交，而不是 HEAD，接到推送对话框。
- 推送对话框里显示 force push 会覆盖掉的远程提交（远程有、本地没有的）。
- 自动 Fetch 的开关与间隔进设置（`dummyGit.autoFetch`、`dummyGit.autoFetchPeriod`，同 VS Code 的 `git.autofetch`）：现在写死在 `core/autoFetch.ts`（默认开，间隔是 `AUTO_FETCH_INTERVAL_MS`），项目还没有设置项，以后和别的设置一起做。
- Update、Checkout 带 autostash：工作区有改动挡住时，先存起来、做完再取回；取回冲突按冲突处理。
- 远程名（分支树里的 `origin`）右键 Fetch：只取这一个远程（第 15 阶段定不做：竖按钮的 Fetch 已经取全部远程）。

## Commit 面板（`product/features/commit.md`、`product/features/trees.md`）

- 按行提交：一个文件里只提交勾了的那几处改动。
- 提交说明的历史下拉。
- 单独的 Rollback 确认页：文件树加复选框，可以在页面里调整勾选。
- 文件右键 Add to .gitignore、Reveal in Explorer / Open in System Folder。
- 树里按空格切换勾选。
- 文件树 / 平铺切换。

## Stash（`product/features/stash.md`）

- 单文件 Stash：只把这一个文件的改动存起来。
- 只存已暂存，或只存未暂存的那一部分。
- Stash 重命名。
- Apply / Pop 时可选还原暂存状态（`stash apply --index`，同 IDEA 的 Reinstate index）：现在取回后全部变成未暂存。

## 冲突（`product/features/conflicts.md`）

- **大** 自建合并界面，替换 VS Code 的合并编辑器（项目负责人定：最终要它，2026-10-10）。所有会产生冲突的操作（Update 分叉、stash 取回、autostash 取回、merge、rebase…）都转进这一个界面。
  - 照 IDEA 三栏：左 Yours、中 Result（可以直接编辑）、右 Theirs，滚动同步。每块改动有箭头「取这边」和 ×「不要这边」；一键应用所有不冲突的改动（左边的 / 右边的 / 全部）；上一处 / 下一处冲突，剩余冲突计数；整个文件取某一边。
  - 点 Apply 写回工作区并标记已解决（和冲突组的「标记已解决」同一条路），还有没处理的冲突时先确认。同一时间只开一个。
  - 三栏内容照旧取暂存区的 `:1` / `:2` / `:3`（`tech/architecture.md` 第 19 题），换的只是「双击打开什么」。要用到文件内七种冲突码的解析（冲突区域模型）。
  - 顺带：冲突文件右键、以及冲突列表上批量的 Accept Ours / Accept Theirs（整个文件取某一边：`checkout --ours/--theirs` + `add`）；rebase 时 ours / theirs 的语义是反的，界面上的文字要按操作类型写。
  - 在它之前不做「合并编辑器只留一个」：`_open.mergeEditor` 不支持预览，替用户关旧标签时保存与否，取决于用户在 VS Code 里勾没勾「不再询问」，可能把用基准占位的草稿写进文件，冲突标记悄悄就没了（2026-10-10 试过后撤回）。
- 停在半路时的 Skip：rebase、cherry-pick、revert 跳过当前这一条接着做（`--skip`），冲突组标题行多一个 › 按钮。
- 操作停在半路时，把 Commit 面板切到前台；在 Stash 模式下就切回 Commit。

## 改写历史（`product/features/history.md`）

- Squash：把选中的提交合成一条（提交列表已能多选，第 14 阶段）。连续的一段在内存里做（同 reword）；弹对话框确认合并后的说明，默认是所有被合并提交的说明拼起来（同 IDEA）。否决先自动拼接说明、不让编辑：说明是 squash 的一半，做一半以后还得改入口。否决 `Squash Commits up to Here…`。
- Drop：提交右键 `Drop Commit…`，原生模态确认。单条用 `rebase --autostash --onto <父提交> <它>`，不必 `rebase -i`；只在当前分支的第一父提交链上、到 HEAD 之间没有合并提交、不是根提交时出现。批量删用提交列表的多选（第 14 阶段已有）。工作区有改动时 autostash，取回冲突按冲突处理。
- **大** 交互式 rebase（同 IDEA）：从某条提交开始，在对话框里调整之后各条提交的顺序和合并方式（pick / reword / edit / squash / fixup / drop），可以拖拽重排。fixup、「把一条并进另一条」都归它。
- Reset 搬进对话框：单选加说明。现在用原生模态框，四个按钮。

## 对话框（`product/features/dialogs.md`）

- 这些功能以后改用对话框：新建分支 / 改名的勾选项、删除分支时「同时删远程」、Merge / Rebase 的选项。

## 日志（`product/features/logging.md`）

- 记 git 的 stdout（同 VS Code 的 `git.commandsToLog`）；一键导出日志（同 IDEA 的 Collect Logs）；记纯界面上的点击；请求带上是哪个按钮发起的。

## 已知问题

- 未跟踪文件成千上万时：树已经是虚拟滚动，但 `git status -uall` 和勾选的推算仍是全量。

## 技术债与触发条件

- 对话框的共用部分抽出来（项目负责人定：**第三种对话框出现时一定要做**）：协议里每种一条的 `openPushDialog` / `openRewordDialog` 合成一条通用的打开命令；页面里各自写的「标签 + 控件」一行与窄屏上下排、输入框读值（`wrappedElement`）、多行说明框（Commit 面板也有一份），抽成 `ui/` 组件。
- 继承来的 `GIT_ASKPASS`：在 VS Code 的终端里跑 `pnpm check`，`cli.test.ts` 的「没给脚本：直接失败」会去问 VS Code 自己的 askpass（十几秒后成功返回，测试失败，还可能弹一次输入框）；扩展不传脚本时，也会继承宿主环境里的 `GIT_ASKPASS`。要定：测试与 `GitCli` 是否清掉继承来的 `GIT_ASKPASS` 等变量（`tech/traps.md` 有临时绕开的办法）。

## 发布

- 上架 VS Code 商店（2026-10-16 暂缓：商店返回 429，账号可能被封）。已定：商店页面与描述只用中文。打包与 GitHub Release 已有（`process/workflow.md` §6）。还缺：商店 README、128×128 图标、CHANGELOG、`keywords` 与 `galleryBanner`，以及把上架接进发布步骤。

## 暂缓

照搬自 IDEA、GitLens 的功能清单，以及以前定过「暂时不做」的。都还没回答「我们这边谁需要它」（`CLAUDE.md` D.6(c)）。要做哪一条，先回答这个问题，再移到上面对应的组里；确定永远不要的，移到 `product/never.md` 并写上理由。

- **Log**：message 里的 URL 高亮可点；Autolink（issue / PR 引用的模式匹配，反查标题）；提交签名（GPG / SSH）验证状态；每个文件的增删行数；Copy Patch to Clipboard（单文件 / 多文件）；提交 hover 气泡预览；按提交日期 vs 作者日期排序；Pin：钉住某个提交，不随选择变化；Select in Log：从详情反查跳回列表并选中；详情模式（单提交 / 多选 / 比较）；详情的 diff 预览停靠位置可切（底部 ↔ 右侧）；另开一个 Log 视图（带独立的过滤条件）；输入框直接 checkout 一个 ref；History Up to Here；滚动预读 3 行；文件列表内搜索 / 过滤。
- **搜索**：搜索操作符语法（`message:` / `author:` / `file:` …）；全词匹配；高亮匹配 ↔ 只显示匹配行；聚焦搜索框的快捷键；按说明搜索走日志索引（不每次现查 `git log`）；独立的 Git tab（搜 hash、分支、tag、说明）；Search & Compare 持久化视图。
- **提交图**：折叠 / 展开整张图；ref 标签的对齐方式与分组折叠、紧凑视图、彩色重叠（16px / 5px）、tag 名称单独显示开关；HEAD 标签只显示图标；按 ref 类型隐藏 / 显示图上的噪声；后台建索引，未建索引的提交单独着色；cherry-pick 来的提交高亮（IDEA 的 Not Cherry-Picked Commits）；车道密度运行时切换；整图样式可切（auto / list / table）；Pin 分支泳道到边缘；minimap 滚动条标记；图自带可收起的侧栏（按分支 / PR / worktree）；图按 worktree 收窄范围；从图直接 Pull / Push / Force Push，直接建 / 删分支、tag、worktree；图拉出去做独立标签 / 新窗口，支持多实例；stash 内联显示在提交列表里（可分别开关）。
- **分支**：已跟踪分支的操作单独成子菜单；最近使用的分支单独一节；视图排序（名称 / 日期，升序 / 降序）；分支比较基准内联显示（相对选定基准的 ahead / behind）；Merge Target（独立于 upstream 的第二个基准）；Checkout with Update（checkout 同时 pull）；Merge / Rebase 到 upstream；独立的 Worktrees 视图；Worktree 感知的文件操作。
- **同步**：记住每个仓库上次输入的推送目标；推送前检查框架（可插拔，独立于 git hooks）；Push 对话框可插件化定制。
- **Commit 面板**：按文件数阈值自动选树还是平铺；内置检查（冲突未解决、CRLF 混用、大文件、用户名未配置…）；提交说明模板（读 `.gitmessage`）；提交前检查框架（独立于 git hooks）；跳过 git hooks 提交的开关；Reformat Commit Message；Stage / Unstage 单个文件；行级回滚（编辑器 gutter 里直接 revert 某几行）；把 gutter 里的改动行移到另一个 changelist；Restore File 到指定 / 上一个版本；「提交并推送」复合按钮。
- **Stash**：Unstash As（用对话框，可以新建分支接住或改名后 apply）；Clear All Stashes；Rollback 的「delete local copies」选项、丢弃后可恢复。
- **冲突**：独立的 Git Conflicts 工具窗口（跨仓库列出全部冲突文件）；冲突标记计数；编辑器旁的冲突通知条；SCM 资源行上的冲突入口；import 语句块自动合并。
- **改写历史**：`fixup!` / `squash!` / `amend!` 前缀自动补全；rebase 对话框里的内联帮助；Rebase 摘要预览卡片（执行前先看计划）；Rebase 暂停原因分类（edit / reword / break / conflict / exec）；Rebase 相关设置集中成一页；图形界面 ↔ 纯文本编辑 todo 互切；Reset 到 tag / tip；多仓库批量 reset。
- **对话框**：弹出面板可拖拽调整大小并记忆；改动统计 legend（新增 / 修改 / 删除各多少个文件）；一个都不选时 OK 按钮禁用；选项跨会话记忆。
- **文件历史与比较**：独立的 File History 视图（编辑器、资源管理器右键 Show File History）；Line History、按行追溯（Diff Line with Previous / with Working）；跟踪重命名；跟随光标与编辑器切换；单条历史版本上 Annotate；整文件 blame（gutter 逐行显示最后改动的提交、作者、时间）、当前行 blame、跳到这次改动之前的 blame、标注里上下逐个改动跳转；Diff with Revision（任意历史版本，From 变体可以先选起点）；目录级 diff；单文件 diff / 单文件取出；Open Changed File Diffs 系列（全部 / 逐个 / 与 merge-base / 与工作区）；Compare With Branch、Diff With Local、与 merge-base 比较、祖先与工作区比较（差异当文件树浏览）；两步式任意两个版本比较（Select for Compare / Compare with Selected）；多选提交互相比较；比较视图的两个提交列表分别记忆折叠状态；保存的比较可复用、可交换方向；Merge Changes with Working（把历史版本的改动并进工作区，而不是覆盖）。
- **diff**：外部 diff 工具集成（单文件 / 全部改动）；组合 diff 视图（多文件改动在一个滚动视图里连续看）；二进制 / 图片 diff；文件热力图（按改动新旧着色）；文件间导航快捷键（⌘F7 / ⇧⌘F7）；打开 diff 时不隐藏侧边栏；diff 编辑器右键 Edit Source。
- **界面与配置**：视图挂靠进原生 SCM 面板或独立成侧栏，用户自选并可互切；视图整体显隐；面板标题栏的 Refresh；配置项（每页条数、自动 fetch、图形密度、默认视图）；整套布局可命名保存 / 应用 / 重置；首次配置的通知提示；GPG Agent 配置引导（配好 pinentry）。
- **统计**：按提交 / 按贡献者聚合；Visualize History；Copy 系列与 Deep Link（`vscode://` 直跳仓库、分支、提交）。
