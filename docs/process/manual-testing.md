# 手动测试（F5 调试窗口）

> F5 打开的调试窗口里是什么仓库、怎么准备现场、手测怎么交接。加场景、改机制时改本文。自动测试见 `process/testing.md`。

## 机制

- 调试窗口打开的是本仓库旁边的**独立仓库** `../<目录名>-debug`，每次 F5 由 preLaunchTask 跑
  `pnpm debug:setup`，按 `.tmp/debug-scenario`（gitignore）记下的**当前场景**删掉重建。
- 选场景 / 换场景：`pnpm debug:setup <场景名>`，再按 F5。
- 重建只清空目录里的东西、不删目录本身：调试窗口开着时，它对工作区根目录的文件监听挂在这个目录上，
  目录一删就没了。用户实测（2026-10-15）：调试窗口开着时换场景，Log、Commit 面板与资源管理器都跟着刷新，不用关窗口。
- 场景 = `scripts/debug/scenarios/<场景名>.mjs`，导出 `build(g)`；`g` 只有 `write` / `git` / `gitMayFail`。
- 身份与时间用本机真实配置（不像 fixture 那样固定），贴近日常使用。

## 交接约定

agent 把一步交给用户手测前：
1. 选好或写好场景，跑 `pnpm debug:setup <场景名>`，看它打出的 `git status` 确认现场对了。
2. 交接消息写「已跑 debug:setup <场景名>，按 F5，看这几点：……」。看哪几点写成编号清单，每条写「做什么 → 应该看到什么」。
   **看哪几点只写在交接消息里**，不写进场景——它随步骤变，不属于场景。
3. 只改纯逻辑、界面没有变化的步骤不交给用户手测，交接消息里说明「这一步不需要 GUI 测试」。

## 加场景

- 按需加（`CLAUDE.md` D.6a）：有一步手测要用它时才加。
- 一个场景尽量一次覆盖同一类的多种形态（如 stash-conflict 一次造出四种冲突），外加不该受影响的对照文件。
- 要远程的场景自己在目标目录里建一个本地 bare 远程，不碰任何真实远程。

## 现有场景

| 场景 | 现场 |
|---|---|
| `stash-conflict` | 停在 stash pop 冲突：both modified / both added / deleted by them / deleted by us 各一，另有已暂存的普通修改、未跟踪文件；stash 仍在列表里 |
| `merge-conflict` | 停在 merge 冲突：main 合并 feature，`f.txt` 两边都改；另有未跟踪的 `note.txt` |
| `branch-menu` | 在 main；feature 与 main 都改了 `f.txt`（合并会冲突），topic 多一个文件（合并会快进），有远程分支记录 `origin/feature`，`note.txt` 有未提交修改 |
| `pull-diverged` | 在 main，跟踪 `origin/main`，两边各有新提交；`note.txt` 有未提交修改；other 也跟踪 `origin/main`、不是当前分支 |
| `push` | 推送对话框：两个远程 origin、fork（本地裸仓库，能真推）；main 跟踪 `origin/main`、本地多两条提交，fork 上的 main 停在 base；feat 没有上游、两个远程上都没有 |
| `push-no-remote` | 推送对话框定义远程：没有远程，main 上两条提交；旁边有空的裸仓库 `target.git`，定义远程时地址填 `target.git` |
| `reword` | 改提交说明：main 上 --no-ff 合并过 feature，之后 one（多行说明）、two、three；只有这三条能改；`a.txt` 已暂存、`b.txt` 未暂存、`c.txt` 未跟踪 |
| `graph` | 看提交图：`--no-ff` 合并（feature/a）、三方合并（x y z）、没合回的 feature/b、跨 35 行的长线（old）、tag v1.0、`origin/main` 落后一个提交；feature/b 跟踪同一提交上的 `origin/feature/b`，a: second 上另有超长名字的分支；全是空提交，工作区干净 |
| `graph-large` | 10,500 个空提交（fast-import 造，约 0.3 秒），同时最多 6 个分支反复分出合回；骨架只取一万条，最后几行父提交缺失、线渐隐；测图的耗时用 |
| `branch-update` | 批量更新分支：在 main；远程 origin 是本地裸仓库，main、feat/a、feat/b 远程各多一条（能快进），fix 本地和远程各多一条（分叉），lonely 没有上游；本地的远程记录还没 Fetch，分叉要 Update 之后才看得出 |
| `branch-delete` | 批量删分支：在 main；本地 topic、feat/login/a、feat/login/b 已合并，wip/x、wip/y 没合并；远程 origin 是本地裸仓库（能真删），上面有 main、old/a、old/b |
| `cherry-pick-batch` | 批量 cherry-pick / revert：在 main，feature 上从旧到新 a、applied、clash、b 四条；applied 已经摘到 main 过（再摘就变空），clash 改 `f.txt` 和 main 冲突；工作区干净 |
| `commit-batch` | Commit 面板的批量操作：停在 merge 冲突里；Conflicts 有 m1、m2（两边都改）、gone1、gone2（一边删了）；Changes 有 src/a、src/b、top；Unversioned 有 new/x、new/y、z |
| `context-menu` | 右键菜单：每块面板上各种节点都有一个。在 main（当前分支），合并过 side，之后 one、two、three 能改说明；本地 topic、feat/login/a、feat/login/b，远程 origin/main、origin/feat/x；stash pop 在 `f.txt` 上冲突、stash 还在；`a.txt` 有修改，未跟踪的 `new.txt` 与 `docs/new/notes.txt` |
| `reset` | 在 main，四条提交（`a.txt` 在后三条里各改一次），`origin/main` 停在第二条；`b.txt` 已暂存、`c.txt` 未暂存的本地改动。看 Keep 被拒：先改工作区的 `a.txt` |
