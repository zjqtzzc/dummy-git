# 第 19 阶段细节：Rollback 对话框

状态：实现中（2026-10-27）。
验收句：点 Rollback 打开编辑器标签页，树上预勾要撤的已跟踪文件，可改勾选，底栏显示勾了几个，点 Rollback 关掉并撤掉勾上的项。

结束标志：`pnpm check` 通过，验收句手动走一遍成立，下面「要核对的条目」逐条勾过。

## 零、要核对的条目

需求（`product/roadmap.md` 第 19 阶段）：
- [ ] 工具栏和右键 Rollback 都打开标签页，不再弹原生确认。谁能点仍由现在的规则定。
- [ ] 标签里一棵只含 Changes 的文件树，打开时勾上刚才要撤的那些，可以改勾。一个都没勾时 Rollback 置灰。
- [ ] 底栏左侧显示勾了几个文件；点 Rollback 关标签，后台撤勾上的项。

## 一、交互细节（逐条定）

1. **开成推送那种标签页**（已定，2026-10-27）
   - 照 IDEA 的 `RollbackChangesDialog`：树上勾选、预勾刚才要撤的、底栏确认。我们做不出顶层模态窗，用已有的编辑器 webview 标签页（`product/features/dialogs.md`）。
   - 否决继续用原生模态框：只能列几个文件名，看不清要撤哪些。

2. **树只列 Changes**（已定，2026-10-27）
   - 已跟踪的 A/M/D/R，不含未跟踪、不含冲突。复用 `FileTree`，默认按目录分组，不加 View Options。
   - 打开时勾上 Commit 面板刚才要撤的那些（什么都没选则全勾，与工具栏一致）；树上仍能改勾。一个都没勾时 Rollback 置灰。

3. **底栏**（已定，2026-10-27）
   - 左侧灰字 `N files`（勾了几个）。IDEA 还分新增/修改/删除数；只要个数。
   - 右侧 Cancel / Rollback。点 Rollback 关标签，后台撤勾上的路径（改名两头仍由扩展补）。不再确认。
   - 否决 IDEA 的「Delete locally added files」：需求池暂缓；我们 `git restore` 已经会删掉新增文件。

4. **不抽共用部分**（已定，2026-10-27）
   - 放宽「第三种对话框出现时一定要抽」。打开命令与推送、改说明并列。记下三处都用了这种标签页，再加一种时再看共性。

## 二、实现顺序

1. **Rollback 标签页**：`DialogKind.Rollback`、`webview/src/rollback/RollbackApp.vue`。测试：预勾集合。
2. **接入口**：工具栏与右键改为 `openRollbackDialog`；`rollback` 不再弹确认。
3. **验收**：见上。
