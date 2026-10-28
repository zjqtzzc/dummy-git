# 第 20 阶段细节：右键 Stash 对话框

状态：实现中（2026-10-27）。
验收句：右键 Stash 打开编辑器标签页，树上预勾要存的文件，可改勾选和名字，底栏显示勾了几个，点 Stash 关掉并按勾上的项存进去。

结束标志：`pnpm check` 通过，验收句手动走一遍成立，下面「要核对的条目」逐条勾过。

## 零、要核对的条目

需求（`product/roadmap.md` 第 20 阶段）：
- [ ] 右键 Stash 打开标签页，不再直接存。谁能点仍由现在的规则定。工具栏 Stash All 仍直接存全部、不问名字。
- [ ] 标签里一棵含 Changes 与 Unversioned 的文件树（不含冲突），打开时勾上刚才要存的那些，可以改勾。一个都没勾时 Stash 置灰。
- [ ] 名字输入框预填 git 那种 WIP 说明；没改就不传 `-m`。底栏显示勾了几个；点 Stash 关标签，后台按勾上的路径存。

## 一、交互细节（逐条定）

1. **开成 Rollback 那种标签页**（已定，2026-10-27）
   - 右键才开。工具栏仍是 IDEA 的 `Git.Stash.Silently`：不问名字、存全部。
   - 否决把工具栏也改成对话框：选中经常只是在看 diff，工具栏已经标明 Stash All。

2. **树列 Changes 与 Unversioned**（已定，2026-10-27）
   - 不含冲突。复用 `FileTree`，默认按目录分组，不加 View Options。
   - 打开时勾上 Commit 面板刚才要存的那些；树上仍能改勾。一个都没勾时 Stash 置灰。
   - 永远 `-u`。否决 IDEA 菜单 `Git.Stash` 的 Keep Index / Include Untracked：文件右键没有那两项，我们右键也一直 `-u`。

3. **名字**（已定，2026-10-27）
   - 输入框预填 git 不传 `-m` 时那种 `WIP on main: 1a2b3c4 fix login`（detached 是 `WIP on (no branch): …`）。
   - 没改（含清空）就不传 `-m`，git 自己生成。改过才 `-m`；列表变成 `On main: 你写的`。这是 git 自己的两套格式。

4. **底栏与执行**（已定，2026-10-27）
   - 左侧灰字 `N files`，右侧 Cancel / Stash。点 Stash 关标签，后台按勾上的路径存（改名两头与暂存区绕法仍由现有 `stashPaths`）。

5. **不抽共用部分**（已定，2026-10-27）
   - 第四种标签页出现，仍不抽打开命令。记下推送、改说明、Rollback、右键 Stash 四处。

## 二、实现顺序

1. **Stash 标签页**：`DialogKind.Stash`、`webview/src/stash/StashApp.vue`。测试：预勾集合、默认 WIP 说明。
2. **接入口**：右键改为 `openStashDialog`；`stash` 收可选 `message`。测试：没改不传 `-m`，改了列表是 `On main: …`。
3. **验收**：见上。
