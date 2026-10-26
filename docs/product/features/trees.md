# 树与打开 diff

> 所有树共用的外观与操作，以及点一个文件怎么打开 diff。改 `tree/`、`logic/tree/`、`vscode/diff.ts` 前先读本文；行为变了就改本文。
> 用到它的有：Log 左栏的分支树（`product/features/branches.md`）、Log 右栏的文件树（`product/features/log.md`）、Commit 面板（`product/features/commit.md`）、Stash 模式（`product/features/stash.md`）。

## 一个基础组件

所有树都用自己画的基础组件 `tree/Tree.vue`，外观和交互照 VS Code 原生的树：行高 22px，每层缩进 11px（这一项按我们自己的），缩进线鼠标在树上时才显示（同 VS Code 默认的 `onHover`）；选中、悬停、焦点框的颜色都取主题的 list / tree 变量。

否决 vscode-elements 的 `vscode-tree`：它只给一个 22px 的图标位、不发展开事件、行的点击和焦点都在它内部处理、没有虚拟滚动。复选框、连带收起子目录、diff 跟随，每一样都得绕着它做，复选框最终绕不过去（点不上、被裁掉）。

| 分工 | 谁负责 |
|---|---|
| 节点的统一形状 `TreeNode`：id（树内唯一）、文字、加粗、图标、颜色、说明、右侧字母、子节点、这一支不要复选框 | `logic/tree/tree.ts` |
| 按展开状态压平成行；收起时连子节点一起收起；全部展开 / 收起；键盘移动；由勾了的叶子推出全选 / 半选 / 未选；选中的两种看法（`selectionViews`、`viewsOfIds`）；复制的文字（`copiedText`） | `logic/tree/tree.ts`（纯逻辑，有测试） |
| 虚拟滚动、行的外观、焦点留在容器上、键盘与点击、选中（规则在 `logic/selection.ts`）、右键时把菜单上下文写到容器上 | `tree/Tree.vue` |
| 数据从哪来、怎么转成 `TreeNode`、图标与配色、展开状态存在哪、勾了以后做什么、打开 diff 的左右两边、右键菜单有哪些项（`menu`）、某一行复制什么（`copyTextOf`） | 各个使用方 |

图标、颜色这些都是数据，「类型 → 图标 / 颜色 / 字母」的表放在各个使用方那里。只有分支树的 ahead / behind 用了一个具名插槽，画在说明后面。

## 分组依据（Commit 面板、Stash）

- 工具栏的 View Options（`MenuButton`，`product/features/menus.md`）里一节 `Group By`，一个勾选项 `Directory`，默认勾着（同 IDEA：`ChangesTree.java:170` 的 `DEFAULT_GROUPING_KEYS`，选单是 `intellij.platform.vcs.impl.shared.xml:99-105` 的 `ChangesView.GroupBy`）。Commit 面板和 Stash 各存各的（`viewState`，`logic/tree/grouping.ts`），Log 右栏的文件树不加。只做 `Directory`：我们没有模块，仓库现阶段只有一个（2026-10-22 项目负责人定）。
- 关掉后文件直接列在组下面（每条 stash 下面），没有目录这一层，按路径排（`buildFileTree` 的 `byDirectory`）。文件后面的灰字只写一种：有原来的灰字（冲突类型、`renamed from …`）写原来的，没有写所在目录，仓库根下的不写；地方不够两样都写（2026-10-22 项目负责人定）。IDEA 平铺时在文件名后面写所在目录（`ChangesBrowserNode.java:348-352` 的 `appendParentPath`）。
- 选中、勾选、右键菜单照旧：目录节点没了，选中里的目录随之落空；勾选按文件记。

## 操作

- **展开**：展开状态由使用方持有（`v-model:expanded`）。分支树按自己的默认值，存进 `viewState`；文件树里新出现的目录默认展开。
- **收起**：收起一个目录时，它下面的子目录一起收起，再展开只露出一层。
- **键盘**：上下移动；左键收起或回到父节点；右键展开；回车打开。焦点留在树的容器上，行不单独获得焦点。
- **鼠标**：单击选中，可展开的节点同时展开 / 收起（同 VS Code 默认的单击展开）；双击打开。点在复选框上只切换勾选（全勾时变成全不勾，否则全勾），不选中也不展开。
- **复选框**：使用方给了勾选集合才画，用共用的 `ui/CheckBox.vue`（`tech/architecture.md` 第 3 题），外观照 IDEA 新界面（`platform-resources/src/themes/expUI/icons/dark/checkBox*.svg`）。目录、组也有复选框：勾上级等于勾下面全部，部分勾选时显示半选。
- **多选**：所有树都能多选，规则同提交列表（`logic/selection.ts`，见 `product/features/log.md`「多选」）：Ctrl+单击（Mac 上 Cmd+单击）加选减选，Shift+单击、Shift+↑↓ 选一段，Ctrl+A 全选看得见的行。按着 Ctrl、Shift 点目录只改选中、不展开收起（同 VS Code）。选中在 `tree/Tree.vue` 里，变了发给使用方；收起的目录里原来选中的暂时不算，展开后又算。
  - diff 跟随、竖按钮、Stash 的按钮都只认「恰好选中一个」，多选时不跟、置灰。
- **复制**（Ctrl+C，Mac 上 Cmd+C）：选中的行按显示顺序一行一个，每行复制它显示的文字：文件是文件名，目录是目录名（紧凑目录是 `src/app`），组是标题，stash 是说明（2026-10-19 项目负责人定）。分支树例外：分支复制全名、HEAD 那行复制当前分支名，只有最后一段贴出去用不了。不另配复制路径的快捷键：资源管理器的 ⌥⌘C 在我们的树里不是现成的，复制名字就够了。
- **右键菜单**：行上不带上下文，右键时由 `Tree.vue` 按选中算好、写到树的容器上（`tech/decisions.md`「右键菜单：每个菜单项一个键」）。算法交给使用方的 `menu`；树给出两种看法（`selectionViews`）：原样看是看得见的选中行，展开看是其中的叶子加上选中目录下面的全部叶子，去掉重复。没给 `menu` 的树（Log 右栏）不出我们的菜单项。

## 文件树

Log 右栏、Commit 面板、Stash 模式共用的一层（`tree/FileTree.vue`、`logic/tree/fileTree.ts`），建在基础组件上：
- 几组文件各整理成一棵目录树：单子目录链合并成一行（紧凑目录）；目录后面写 `N files`；目录在前，都按名字排序。
- 文件名用 `--vscode-gitDecoration-*` 的颜色，右边是字母 `A` / `M` / `D` / `R`；改名显示新名字，后面跟一段浅色的 `renamed from <旧名>`。图标用 Seti（照 VS Code 自带图标主题生成的快照；按文件名查的优先级、图标字体关掉次像素抗锯齿，也同 VS Code）。
- 不加仓库名那一层根节点。
- 组那一行的 id 就是组的 id；组下面目录与文件的 id 是 `<组 id>/<路径>`（组的 id 不含 `/`，两者撞不上）。同一个目录、同一个文件可以同时出现在几组里（Changes 与 Unversioned Files 共用一个目录，几条 stash 改了同一个文件），只用路径当 id 就会撞：展开、选中两组一起变，Vue 的 key 重复时旧行留在页面上删不掉（2026-10-26 外部提交后出现）。勾选、打开、右键对外仍按路径（`filesById`、`checkedIds`），同一路径在几组里各有一行时（删除 + 未跟踪）勾一行几行都勾上。

## 打开 diff

**所有文件树都走同一个函数**（`vscode/diff.ts`），用 VS Code 自带的 diff 编辑器：
- **打开**（双击、回车）：直接打开。
- **跟随**（单击、方向键）：只有当前编辑组前台已经是一个 diff（不管是谁打开的）时，才换成选中的文件；否则什么都不做，不把 diff 翻到你正在看的东西前面。
- 焦点留在面板上，方便用键盘接着往下翻。
- 都用预览标签打开：同一组里新的预览会替换旧的，所以我们不用自己找标签、关标签。

diff 的一边有四种（`shared/diff.ts`），左右可以自由组合：
| 一边 | 内容 | 用在 |
|---|---|---|
| 某个提交里的文件 | `git cat-file --filters <hash>:<路径>`，经我们自己的只读文件系统（`dummygit:` scheme）提供 | Log 右栏、Stash、Commit 面板的左边 |
| 不存在 | 空 | 新增文件的左边、删除文件的右边 |
| 工作区里的真实文件 | `file:` URI，在 diff 里可以直接编辑保存 | Commit 面板的右边 |
| 冲突时暂存区的一栏 | `:1` / `:2` / `:3` | 合并编辑器（`product/features/conflicts.md`） |

- URI 里只放完整 hash，这样历史版本的内容永远不会变。URI 的格式只在 `vscode/revisionUri.ts` 一处定义：VS Code 会把它存进标签页，重新加载窗口后还会拿回来找我们要内容，所以枚举值不能顺带成为 URI 的一部分。
- 用 `--filters`：内容按 `.gitattributes` 做换行和过滤器转换，和用户检出的文件一致；解码交给 VS Code，按用户的编码设置来。
- 标题写成 `foo.ts (1a2b3c4 ↔ 9f8e7d6)`，短 hash 和 Log 里的写法一样；不存在的一边写 `none`，工作区那一边写 `Working Tree`。
