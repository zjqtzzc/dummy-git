# 第 17 阶段细节：图标按钮的选单

状态：实现中（2026-10-21）。
<!-- 之后依次改成：实现中 → 实现完，待手动验收（`pnpm check` 通过，N 个测试）→ 完成。完成后并进 product/features/ 并删掉本文（process/workflow.md §2）。 -->
验收句：工具栏上点开会弹选单的图标按钮，右下角带一个小三角；点开是贴着按钮的浮层选单，上下左右都不超出面板，点外面或按 Esc 收起。View Options 用它开关三种高亮。

结束标志：`pnpm check` 通过，验收句手动走一遍成立，下面「要核对的条目」逐条勾过。

## 要解决什么问题

- 点了会弹选单的图标按钮，和点了直接执行的长得一样，点之前看不出来（IDEA 在前者右下角画小三角）。
- 选单用的是 VS Code 原生 QuickPick，从窗口顶部正中弹下来，离点的按钮很远。
- 以后还会有带二级选单的按钮；每个按钮各写一套弹出、定位、收起，写起来费事，也难保一致。

## 零、要核对的条目

需求（`product/roadmap.md` 第 17 阶段）：
- [ ] 有选单的图标按钮右下角带小三角，直接执行的不带
- [ ] 选单是 webview 里的浮层，贴着按钮；上下左右超出时翻面、挪动，上下都放不下时限高滚动
- [ ] 二级选单：选单项的写法、悬停打开、延迟关闭、定位（手测等第一个真正用到二级的地方，2026-10-21 项目负责人定）
- [ ] 收起：点外面、按 Esc、webview 失去焦点、点了普通项；勾选项点了不收起
- [ ] View Options 换成浮层选单，`pickMany` 删掉

`tech/architecture.md`：第 3 题（控件选型：工具栏图标按钮一律用 `ToolButton`，本阶段补上 `MenuButton`）；第 22 题（定位、开着哪串选单的规则放 `logic/`，纯 node 下测）。

## 一、交互细节（逐条定）

参照：IDEA 在 `.notes/rebased-master`（画三角的 `ActionButton` 不在这份裁剪里，只能从关掉三角的地方反推）；GitLens 在 `.notes/vscode-gitlens-main`；vscode-git-graph 在 `.notes/vscode-git-graph`。

1. **只管工具栏上的图标按钮**（已定，2026-10-21 项目负责人定）
   - 过滤栏的文字按钮（Branch、User、Date、Paths）不动，仍用 QuickPick；推送对话框里 Force Push 的浮层不动，和本阶段无关。
   - 现有的图标按钮里只有 View Options 有选单。Rollback、Delete 弹确认框，New Branch 弹输入框，都算直接执行：点了就是这个动作，只是执行中问一句（同 IDEA，这些按钮没有三角）。

2. **两种按钮：基础按钮与选单按钮**（已定，2026-10-21 项目负责人定）
   - 基础按钮就是现在的 `ui/ToolButton.vue`，不改：22px 见方，悬停背景、焦点框、置灰、`title` 提示，全在这一处。
   - 选单按钮 `ui/MenuButton.vue` 里面包着 `ToolButton`，多做三件事：右下角画小三角；管选单开着还是关着（再点一次关上）；把选单项交给浮层。它不认识任何具体选单。
   - 三角：右下角一个直角朝右下的小三角形，边长 4px 左右，和图标同色。IDEA 的尺寸没有源码可对，照截图估，手测时再调。
   - IDEA 的规则（反推）：点了弹一组选项的工具栏按钮默认画三角，不想要的要显式设 `ActionUtil.HIDE_DROPDOWN_ICON`；只有一个子项、点了直接执行时（`isPerformGroup`）同时关掉三角（`platform/vcs-impl/src/com/intellij/openapi/vcs/changes/ignore/actions/IgnoreFileActionGroup.kt:84-86`，`plugins/git4idea/backend/src/remote/hosting/action/HostedGitRepositoryReferenceActionGroup.kt:29-31`）。图标本身就是齿轮、「⋯」的也关掉（`plugins/git4idea/shared/src/com/intellij/vcs/git/branch/popup/GitBranchesPopupHeaderActions.kt:23-24`）。Log 的 View Options（`Vcs.Log.PresentationSettings`）没关，所以有三角。

3. **选单用数据描述**（已定，2026-10-21 项目负责人定）
   - 别人的做法：IDEA 是一组动作（`ActionGroup.getChildren()`），有普通动作、勾选（`ToggleAction` 的 `isSelected` / `setSelected`）、可带标题的分隔线（View Options 的「Highlight」，`platform/vcs-log/impl/src/com/intellij/vcs/log/ui/actions/HighlightersActionGroup.java:32`），组里再放一个弹出的组就是二级选单。GitLens 的 `gl-menu-popover`（`src/webviews/apps/shared/components/menu/menu-popover.ts`）是按钮从插槽进、选单项用 `items` 数组进，组件管弹出、收起；只有一级。共同点：用的地方交一组数据，按钮管其余的。
   - 我们：选单项是 tagged union，放在 `logic/popupMenu.ts`（叫 popup，和右键菜单的 `logic/menuItems.ts` 分开）：
     ```ts
     enum PopupItemKind { Action, Toggle, Submenu, Separator }
     type PopupItem =
       | { kind: Action;    label: string; disabled?: boolean; run: () => void }
       | { kind: Toggle;    label: string; checked: boolean; disabled?: boolean; toggle: (on: boolean) => void }
       | { kind: Submenu;   label: string; disabled?: boolean; items: readonly PopupItem[] }
       | { kind: Separator; label?: string }
     ```
     用的地方只交出这样一个数组（`<MenuButton :icon :title :items />`）；加二级选单就是往数组里放一个 `Submenu`，不另写代码。
   - 勾选项前面画 ✓（同 VS Code 菜单）；带 `label` 的分隔线是一节的小标题。

4. **浮层的位置：上下左右都不超出 webview**（已定，2026-10-21 项目负责人定）
   - 通行做法（Floating UI 的 placement、flip、shift、size 四步；vscode-git-graph 的右键菜单同理，`web/contextMenu.ts:74-86`：下面放得下就往下、否则上面放得下就往上、都不行就挪到重叠，左右同样）：
     1. 首选位置：一级选单在按钮正下方、左边对齐，留 2px 空隙；二级选单在父项右边、顶部和父项对齐。
     2. 翻面：首选那边放不下、对面放得下，翻到对面。二级选单翻到父项左边；父项和选单一样宽，所以就是翻到父选单左边。
     3. 另一个方向：一级选单左边对齐按钮，右边超出就改成**右边对齐按钮**，两边都不行才贴着边缘（同 VS Code：`src/vs/base/common/layout.ts` 的 `layout`，`contextview.ts` 的 `layout2d` 横向用 `ALIGN`）；二级选单上下超出时往回挪到刚好不超出。否决一级选单「往回挪到刚好不超出」：按钮在工具栏右边时，选单和按钮对不齐。VS Code 的二级选单上下放不下时是翻到上面、两边都放不下时盖住父选单并偏 10px（`menu.ts` 的 `calculateSubmenuMenuLayout`），我们保留往回挪、贴边：二级离父项更近，Log 面板里很少碰到两边都放不下（2026-10-21 项目负责人定）。
     4. 限高：上下都放不下时，放在空间大的那一边，高度压到放得下，选单里滚动。
   - 边界是 webview 自己（`window.innerWidth` / `innerHeight`）：浮层画不出它。底部的 Log 面板可能拉得很矮，这一条最常碰到。
   - 一个纯函数 `placePopup(贴着的矩形, 首选方向, 浮层尺寸, webview 尺寸) → 位置与限高`，一级二级共用，放 `logic/`。自己写，不引入 `@floating-ui/dom`（2026-10-21 项目负责人定）：几十行，配测试。
   - 浮层挂在页面最外层（Vue 的 `Teleport`），不被工具栏这类有 `overflow` 的容器裁掉。

5. **点了之后**（已定，2026-10-21 项目负责人定）
   - 普通项：执行，整串选单收起。
   - 勾选项：切换开关，选单不收起，可以连着勾几项。IDEA 推断如此：要点完就收起的勾选项都显式设 `KeepPopupOnPerform.Never`（`platform/vcs-impl/src/com/intellij/openapi/vcs/actions/AnnotateToggleAction.java:74`、`platform/vcs-log/impl/src/com/intellij/vcs/log/ui/filter/StructureFilterPopupComponent.java:470`），高亮的 `BooleanPropertyToggleAction` 没设。GitLens 默认收起，可设 `keepOpenOnSelect`。
   - 二级选单项：照 VS Code（`menu.ts` 的 `SubmenuMenuActionViewItem`，2026-10-21 读的 `main`）分两段计时：鼠标停在二级选单项上满 **250 ms**、那时还停着才打开；移到同一级别的项上，开着的二级选单 **750 ms** 后才关，这期间鼠标进入二级选单就不关，斜着移过去不误关。点二级选单项立刻打开。否决「安全三角」（Floating UI 的 `safePolygon`、Radix 的 pointer grace area）：手感更好，代码多；VS Code 也只靠延迟。
   - 点浮层外面、按 Esc、webview 失去焦点：整串收起。
   - 键盘只有 Esc（2026-10-21 项目负责人定）：方向键、Enter 不做，省代码。
   - 置灰的项不响应点击。

6. **View Options 换过来**（已定，2026-10-21）
   - 一节标题 `Highlight`，下面 `My Commits`、`Merge Commits`、`Current Branch` 三个勾选项。勾一下马上生效、存进 `viewState`，没有「确认」。
   - `pickMany` 请求没人用了，删掉：协议、参数校验、处理函数、`vscode/pick.ts` 的 `pickMany`、日志那一行，连同它们的测试。

## 二、实现顺序

每步一个概念，`pnpm check` 通过、手动看过、项目负责人确认后单独提交。

1. **定位**（第 4 条）：`logic/` 里的 `placePopup`。测试：放得下时在首选位置；四个方向各自超出时翻面或挪动；上下都放不下时限高；二级选单翻到父选单左边。
2. **选单项与一级浮层**（最小宽度 160px、行高 24px，同 VS Code 的 `.monaco-menu`）（第 3、5 条）：`logic/popupMenu.ts` 的类型；`ui/PopupMenu.vue` 画一级；收起规则。测试：各种选单项点了之后收不收起（规则写成 `logic/` 里的纯函数）。手测等第 4 步接上按钮。
3. **二级选单**（第 3、4、5 条）：`PopupMenu` 逐级画下去；悬停打开、延迟关闭。测试：开着哪一串选单（悬停、离开、移到同级）。手测等第一个真正用到二级的地方。
4. **`MenuButton`**（第 2 条）：包着 `ToolButton`，画三角，管开关，挂浮层。和第 5 步一起手测。
5. **View Options 换过来、删 `pickMany`**（第 6 条）。手测：三角；浮层位置（把面板拉矮、拉窄看它怎么躲）；连着勾几项；点外面、Esc、切到别的窗口都收起。
6. **验收**：「要核对的条目」逐条勾过；并进 features 文档（`log.md` 的 View Options 一条改掉 QuickPick 的说法），`architecture.md` 第 3 题补上 `MenuButton`，`decisions.md` 记下选单的写法与否决过的做法；需求池「过滤栏按钮改成下拉菜单」补一句可以复用 `PopupMenu`；删掉本文。
