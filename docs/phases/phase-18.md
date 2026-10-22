# 第 18 阶段细节：视图选项

状态：定细节中（2026-10-22）。
<!-- 之后依次改成：实现中 → 实现完，待手动验收（`pnpm check` 通过，N 个测试）→ 完成。完成后并进 product/features/ 并删掉本文（process/workflow.md §2）。 -->
验收句：Commit 面板与 Stash 各有一个 View Options 按钮，能关掉「按目录分组」，文件直接平铺；Log 过滤栏有一个 Graph Options 按钮，能在「按提交时间」和「拓扑」两种排序之间切换。

结束标志：`pnpm check` 通过，验收句手动走一遍成立，下面「要核对的条目」逐条勾过。

## 要解决什么问题

- 改动分散在很多目录里时，一层层目录很占地方，只想看一列文件。
- 提交图按提交时间排，几条分支穿插在一起；想让同一支历史连在一起看。

## 零、要核对的条目

需求（`product/roadmap.md` 第 18 阶段）：
- [ ] Commit 面板、Stash 各有 View Options（`Group By` → `Directory`），默认按目录分组，各自记住
- [ ] 不按目录分组时文件平铺在组下面，按路径排；文件后面的灰字：有原来的灰字写原来的，没有写所在目录
- [ ] Log 的 Graph Options（`Sort` → `By Commit Date` / `Topologically`），单选，默认按提交时间，记住
- [ ] 浮层选单加上单选项

`tech/architecture.md`：第 8 题（骨架命令多一个排序参数）。

## 一、交互细节（逐条定）

参照：IDEA 在 `.notes/rebased-master`。

1. **Commit 面板、Stash 的 View Options**（已定，2026-10-22 项目负责人定）
   - IDEA：View Options 选单里一节 `Group By`，下面 `Directory`、`Module`、`Repository` 几个勾选项（`platform/vcs-impl/shared/resources/intellij.platform.vcs.impl.shared.xml:99-105`，`platform/vcs-impl/shared/src/com/intellij/openapi/vcs/changes/actions/ChangesGrouppingActions.kt`）；Commit 视图的按钮是眼睛（`AllIcons.Actions.Show`，同 xml `:134`），搁置区也有同一节（`platform/vcs-impl/resources/META-INF/VcsActions.xml:256`）。默认按目录分组（`ChangesTree.java:170` 的 `DEFAULT_GROUPING_KEYS`），每棵树各自记。
   - 我们：Commit 工具栏、Stash 工具栏各加一个 View Options（`MenuButton`，`AppIcon.ViewOptions`），放在全部展开、全部收起前面。一节 `Group By`，一个勾选项 `Directory`，默认勾着。两个视图各存各的（`viewState`，落盘字符串走映射表）。只做 `Directory`：我们没有模块，仓库现阶段只有一个。
   - Log 右栏的文件树不加。

2. **不按目录分组时**（已定，2026-10-22 项目负责人定）
   - 文件直接列在组下面（Conflicts、Changes、Unversioned Files，每条 stash 下面），没有目录这一层，按路径排。
   - 文件后面的灰字只写一种：有原来的灰字（冲突类型、`renamed from …`）写原来的，没有写所在目录（仓库根下的文件不写）。地方不够两样都写。IDEA 平铺时在文件名后面用灰字写所在目录（`ChangesBrowserNode.java:348-352` 的 `appendParentPath`）。
   - 选中、勾选、右键菜单照旧：目录节点没了，选中里的目录随之落空；勾选按文件记，不受影响。全部展开、全部收起照旧管组。

3. **Log 的 Graph Options**（已定，2026-10-22 项目负责人定）
   - IDEA：过滤栏里一个按钮，图标 `IntelliSort`（`platform/vcs-log/impl/src/com/intellij/vcs/log/ui/filter/VcsLogGraphOptionsChooserGroup.java`，挂在 `VcsLogClassicFilterUi.kt:202`）；一节 `Sort`，两项 `By Commit Date`、`Topologically`（`VcsLogBundle.properties:326-329`），多选一；默认 `By Commit Date`（`PermanentGraph.kt:77` 的 `Options.Default`）。第二节 `Options`（First Parent 等）不在本阶段。不是默认值时按钮上加小圆点（`hasNonDefaultOptions`）：不做（项目负责人定）。
   - 我们：过滤栏里 View Options 左边加 Graph Options（`MenuButton`），图标照 IDEA 新界面的 `platform/vcs-log/impl/resources/icons/new/intelliSort.svg` 重画成线条（左边向下的箭头，右边一条竖线串着两个提交），进 `ICON_STROKES`。一节 `Sort`，两个单选项 `By Commit Date`（默认）、`Topologically`，存进 `viewState`。
   - git：`By Commit Date` 是现在的 `--date-order`，`Topologically` 是 `--topo-order`；`getSkeleton` 多一个排序参数。切换就是换参数重取骨架，走现有的刷新（选中留着、视图不跳）。
   - **和 IDEA 不一样**（2026-10-22 项目负责人定：先按 git 来）：IDEA 的 `Topologically` 是它自己的 IntelliSort，合并进来的那一支紧挨着排在合并提交下面；`--topo-order` 只保证同一支历史不和别的支穿插。IDEA 能这样做，是因为它把全部提交读进内存建成图，排序、过滤都在内存里算，切换不重跑 git。以后可能也迁到内存（需求池）。

4. **单选项**（已定，2026-10-22）
   - 浮层选单的选单项加一种 `PopupItemKind.Radio`：`selected` + `select()`。点了选中它，点已经选中的那一项什么都不做；选单不收起，同勾选项。
   - 选中的画 ✓，同 IDEA、VS Code（它们的单选、多选都画 ✓）。

## 二、实现顺序

每步一个概念，`pnpm check` 通过后单独提交。手测攒成两次。

1. **平铺**（第 2 条）：`buildFileTree` 多一个「按不按目录分组」；平铺时的排序与灰字。测试：平铺后的节点、排序、灰字的两种情况。
2. **Commit、Stash 的 View Options**（第 1 条）：两个按钮、开关的存与读回。测试：存了读回原样、认不出的当默认。**第一次 F5**：第 1、2 步。
3. **单选项**（第 4 条）：`logic/popupMenu.ts` 加 `Radio`，`PopupList` 画 ✓。测试：点了选中、点已选中的不动、选单不收起。
4. **骨架的排序参数**（第 3 条）：`getSkeleton` 加排序，参数校验。测试：两种排序给出的顺序不同（造一个按时间与按拓扑排出来不一样的仓库）。
5. **Graph Options**（第 3 条）：图标、按钮、存与读回、换排序重取骨架。**第二次 F5**：第 3～5 步。调试场景加一个两条分支交错提交的仓库。
6. **验收**：并进 `product/features/commit.md`、`stash.md`、`trees.md`、`log.md`、`graph.md`，`architecture.md` 第 8 题写上排序参数；删掉本文。
