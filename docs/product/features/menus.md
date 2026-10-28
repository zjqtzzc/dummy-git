# 图标按钮与浮层选单

> 工具栏上的图标按钮分两种：直接执行的，和点了弹出选单的。改 `ui/ToolButton.vue`、`ui/MenuButton.vue`、`ui/PopupMenu.vue`、`ui/PopupList.vue`、`logic/popupMenu.ts`、`logic/popupPlacement.ts` 前先读本文；行为变了就改本文。
> 用到选单的有：Log 过滤栏的 Graph Options（`product/features/graph.md`「排序」）、View Options（`product/features/log.md`「高亮」）；Commit 面板、Stash 的 View Options（`product/features/trees.md`「分组依据」）。过滤栏的文字按钮（Branch、User、Date、Paths）仍用原生 QuickPick，推送对话框里 Force Push 的浮层是它自己的（`product/features/sync.md`），都不归本文。

参照：IDEA 在 `.notes/rebased-master`（画三角的 `ActionButton` 不在这份裁剪里，只能从关掉三角的地方反推）；VS Code 的菜单读的是 GitHub 上 `main`（2026-10-21）：`src/vs/base/browser/ui/menu/menu.ts`、`src/vs/base/browser/ui/contextview/contextview.ts`、`src/vs/base/common/layout.ts`；GitLens 在 `.notes/vscode-gitlens-main`。

## 两种按钮

- **直接执行**：`ui/ToolButton.vue`，22px 见方，悬停背景、焦点框、置灰、`title` 提示全在这一处。工具栏上的图标按钮一律用它（`tech/architecture.md` 第 3 题）。
- **有选单**：`ui/MenuButton.vue`，里面包着 `ToolButton`，多做三件事：右下角画小三角（直角朝右下，边长 4px，和图标同色，置灰时一起变淡）；点了打开浮层选单，再点一次关上；收起（见下）。它不认识任何具体选单，选单项由用的地方交进来。
- 确认框、输入框不算选单：Delete 弹确认框，New Branch 弹输入框，点了就是这个动作，只是执行中问一句，没有三角。Rollback、右键 Stash 开的是标签页对话框。
- IDEA 的规则（反推）：点了弹一组选项的工具栏按钮默认画三角，不想要的显式设 `ActionUtil.HIDE_DROPDOWN_ICON`；只有一个子项、点了直接执行时同时关掉三角（`platform/vcs-impl/src/com/intellij/openapi/vcs/changes/ignore/actions/IgnoreFileActionGroup.kt:84-86`，`plugins/git4idea/backend/src/remote/hosting/action/HostedGitRepositoryReferenceActionGroup.kt:29-31`）；图标本身就是齿轮、「⋯」的也关掉（`plugins/git4idea/shared/src/com/intellij/vcs/git/branch/popup/GitBranchesPopupHeaderActions.kt:23-24`）。

## 选单用数据描述

- 选单项是 tagged union（`logic/popupMenu.ts` 的 `PopupItem`）：普通项（`run`）、勾选项（`checked` + `toggle`）、单选项（`selected` + `select`，一组里选一个，比如排序方式）、二级选单（`items`，几级都行）、分隔线（带 `label` 就是一节的小标题）；前四种都能 `disabled`。用的地方只交一个数组：`<MenuButton :icon :title :items />`。
- 同 IDEA 与 VS Code：IDEA 是一组动作（`ActionGroup.getChildren()`，勾选是 `ToggleAction`，分隔线可带标题，组里再放弹出的组就是二级）；VS Code 是一组 `IAction`，二级是 `SubmenuAction`。GitLens 的 `gl-menu-popover` 也是 `items` 数组进、组件管弹出收起，但只有一级。
- 勾选项、单选项选中的前面都画 ✓（同 IDEA、VS Code：它们的单选、多选都画 ✓），每行都留出这一列，有勾没勾的文字对齐；二级选单项右边画 ›。外观照 VS Code 的菜单：主题的 `menu.*` 颜色、`widget.shadow` 阴影，最小宽度 160px，行高 24px。
- 和右键菜单（`logic/menuItems.ts`，VS Code 原生的 `webview/context`）是两回事。
- 否决原生 QuickPick：从窗口顶部正中弹出，离按钮太远，也做不了勾选项连着勾。否决每个按钮自己写一套弹出、定位、收起：难保一致，二级选单写一次就够费事。

## 位置：上下左右都不超出 webview

`logic/popupPlacement.ts` 的 `placePopup(贴着的矩形, 首选方向, 浮层尺寸, webview 尺寸)`，一级二级共用，分首选位置、翻面、另一个方向、限高四步（同 Floating UI 的 `placement`、`flip`、`shift`、`size`）。浮层先按自然尺寸画在看不见的地方量出大小，再挪过去；挂在页面最外层（`Teleport`），不被有 `overflow` 的容器裁掉。

- **一级选单**：按钮正下方，留 2px。下面放不下、上面放得下，翻到上方；上下都放不下，放在空间大的那边并压低高度，选单里滚动。左右：左边对齐按钮，右边超出就改成右边对齐按钮，都不行才贴着边缘（同 VS Code：`layout.ts` 的 `layout`，`contextview.ts` 的 `layout2d` 横向用 `ALIGN`）。否决「往回挪到刚好不超出」：按钮在工具栏右边时选单和按钮对不齐。
- **二级选单**：父项右边，顶部对齐，不留空隙。右边放不下翻到父选单左边（父项和选单一样宽）；左右都放不下，挪进可见范围、盖住父选单一部分；上下超出往回挪，比整个面板还高时从顶上开始并限高。VS Code 是上下放不下就翻到上面、两边都放不下就盖住并偏 10px（`menu.ts` 的 `calculateSubmenuMenuLayout`）；我们保留往回挪、贴边：二级离父项更近，Log 面板里很少两边都放不下（2026-10-21 项目负责人定）。
- 只压低高度，不压窄宽度：选单项的文字被截断比挪过去盖住一点更难用。
- 自己写，不引入 `@floating-ui/dom`（2026-10-21 项目负责人定）：几十行，配测试。

## 点了之后、什么时候收起

- **普通项**：执行，整串选单收起。
- **勾选项**：切换，选单**不收起**，可以连着勾几项（2026-10-21 项目负责人定）。IDEA 推断如此：要点完就收起的勾选项都显式设 `KeepPopupOnPerform.Never`（`platform/vcs-impl/src/com/intellij/openapi/vcs/actions/AnnotateToggleAction.java:74`），高亮的 `BooleanPropertyToggleAction` 没设。
- **单选项**：选中它，选单不收起；点已经选中的那一项什么都不做。
- **置灰的项、分隔线**：什么都不做。
- **二级选单**（照 VS Code 的 `SubmenuMenuActionViewItem`）：鼠标停在二级选单项上满一段时间（`SUBMENU_OPEN_DELAY`）、那时还停着才打开；移到同一级别的项上，开着的二级选单再过一段时间（`SUBMENU_CLOSE_DELAY`）才关，两个取值同 VS Code，在 `logic/popupMenu.ts`；点二级选单项立刻打开。鼠标离开某一级时等着的那次作废：斜着移进二级选单时擦过了同级别的项，不误关；停满之前就移走了，不再打开。开着哪一串、停下之后要怎样改、等多久，都是 `logic/popupMenu.ts` 里的纯函数（`planHover`、`pathAfterClick`、`openLevels`）；`PopupMenu` 只管那一个计时器，每一级是一个 `PopupList`，平铺画出来。否决「安全三角」（Floating UI 的 `safePolygon`、Radix 的 pointer grace area）：手感更好，代码多；VS Code 也只靠延迟。
- **整串收起**：点选单外面（按在按钮上不算，交给按钮自己的点击去关，否则先关又打开）、按 Esc、webview 失去焦点。
- 键盘只有 Esc（2026-10-21 项目负责人定）：方向键、Enter 不做。
- 二级选单还没有地方用到，手测等第一个真正用到的地方（2026-10-21 项目负责人定）。
