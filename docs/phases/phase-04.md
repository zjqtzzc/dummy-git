# 第 4 阶段细节：分支与 Stash

状态：完成（2026-10-08）。核对清单逐条勾过；验收句手动走一遍；`pnpm check` 通过（445 个测试）。
验收句：左栏分支右键可以切换、新建、重命名、删除；Commit 面板切到 Stash，一键存、Pop、Apply、删除。切不过去时显示 git 的报错。不 merge，不 rebase。

结束标志：`pnpm check` 通过，验收句手动走一遍成立，下面「要核对的条目」逐条勾过。

## 零、要核对的条目

需求（`product/roadmap.md` 第 4 阶段）：
- [x] 左栏分支右键：切换、从这里新建分支、重命名、删除（另有竖按钮区的 New Branch from Selected）
- [x] Commit 面板顶上切换 Commit / Stash 两种模式
- [x] Stash 模式：列出全部 stash，时间写法和 Log 一样（共用 `formatTime`）
- [x] 一键存，不问名字（勾了的存勾选，没勾存全部，都带 `-u`）
- [x] 对一条 stash：工具栏 Apply、Delete；右键 Pop、Apply ｜ Delete
- [x] 切换失败显示 git 的报错：未提交改动挡住（手动看过）；分支被别的 worktree 占用（实测 git 报 `fatal: 'feat' is already used by worktree at …`，`run` 原样抛给错误关口）

`tech/architecture.md`：
- [x] 第 15 题：命令注册包装——`vscode/menu.ts`，同一张参数校验表、同一个 handler、同一个错误关口。后台任务关口仍未出现会往外抛错的后台任务，不做
- [x] 第 15 题已知错误：未提交的改动挡住切换——按第一节第 7 条先显示 git 原文，ARCHITECTURE 该行已同步
- [x] 第 12 题：分支与 stash 的写操作都是 `Exclusive`（本地道），删远程分支 `Remote`，列 stash、校验分支名 `None`；Checkout、New Branch、Stash 存 / Apply / Pop、删远程分支走进度出口

`tech/traps.md` 第 1 节第 4 阶段：重命名当前分支（git 允许，有测试）、删除远程分支跑成删本地（有测试：本地同名分支不动）、从远程分支 checkout 时本地分支名的推导（用 `Ref.name`，不拆字符串）、删除当前选中的分支后面板刷新（`BranchTree` 按 id 重新报选中）——都已覆盖。新踩到两个坑已记入：`stash push -- <路径>` 遇到已暂存的删除、`drop` / `pop` 只认 `stash@{n}`。
另：第 2 节「面板刷新」的三条对 Stash 列表成立：展开与选中不在刷新路径上；只在第一次载入前显示 `Loading…`；不自己匹配 gitignore。

## 一、交互细节（逐条定）

**已定**
1. **右键菜单用 VS Code 原生的**（`package.json` 的 `webview/context`，元素上用 `data-vscode-context` 标出分支与类型，菜单项是扩展注册的命令）。外观与键盘（菜单键、Shift+F10、Esc）都是原生的，不踩自己画菜单的坑（超出视口、滚动、失焦）。菜单项不经过 Router，所以 tech/architecture.md 第 15 题的「命令注册包装」关口在这一阶段做。参照 GitLens 的 Graph。
2. **菜单项**：按「由轻到重」分组、组间分隔线（`tech/decisions.md`「右键菜单的排序与分隔」）：Checkout ｜ Pull、Push（本地分支，阶段完成后补上）｜ New Branch from Here…、Rename… ｜ Delete。不可用的项**不出现**（`when` 条件），不置灰。
   | 节点 | Checkout | New Branch from Here… | Rename… | Delete |
   |---|---|---|---|---|
   | 本地分支（非当前） | ✓ | ✓ | ✓ | ✓ |
   | 当前分支（含 HEAD 行） | — | ✓ | ✓（git 允许） | —（git 不许删当前分支） |
   | 远程分支 | ✓（建跟踪它的本地分支，见第 3 条） | ✓ | —（git 没有改远程分支名） | 见第 6 条 |
   | HEAD 行（游离） | — | ✓（从当前提交） | — | — |
   | 目录、分组 | 不弹菜单 | | | |
3. **Checkout** 统一用 `git switch`（最低 2.23 已满足；`checkout` 兼管恢复文件，参数有歧义）。
   - 本地分支 `B`：`git switch B`。
   - 远程分支 `origin/feat`：本地名用 `Ref` 里不带远程前缀的 `name`（不拆字符串）。
     | 情况 | 做法 |
     |---|---|
     | 本地没有 `feat` | `switch -c feat --track origin/feat` |
     | 本地 `feat` 跟踪 `origin/feat`，一样或领先 | 切到本地 `feat` |
     | 同上，本地落后 | 切过去并快进：`switch feat` + `merge --ff-only origin/feat`（本地记录，不联网） |
     | 同上，分叉 | 只切过去、不动它，状态栏提示 `feat and origin/feat have diverged`。IDEA 此时让用户选 rebase 还是丢弃本地——需求池，等 rebase 可用时做 |
     | 本地 `feat` 跟踪别的或没有上游 | 不切，提示 `A local branch named feat already exists and doesn't track origin/feat.` |
   - 工作区有改动：不冲突时 git 会带过去，不拦；冲突时 git 拒绝，文案见第 7 条。
4. **New Branch from Here…**：起点是右键点中的节点（本地分支、远程分支、HEAD 行即当前提交）。
   竖按钮区另有一个入口：最上面的 **New Branch from Selected**（codicon `add`），起点是分支树里选中的节点，选中目录、分组或没选时置灰。两个入口是同一条协议命令 `newBranch`，起点由同一个 `startOf` 算出。
   - 名字用 VS Code 原生输入框（标题 `New branch from origin/feat`，默认空）。边输入边校验：`git check-ref-format --branch` 判合法、对照分支列表判重名，不合法时输入框下提示、确定点不了。
   - 建完直接切过去：一条 `git switch -c 新名 --no-track 起点`（同 IDEA 新建分支对话框默认勾上的「Checkout branch」）。
   - `--no-track`：从远程分支建时 git 默认跟踪起点，新分支点 Push 就会推到别人的分支上。不跟踪，第一次推送按第 3 阶段规则推到同名并设上游。
   - 切不过去（工作区改动冲突）时 `switch -c` 连分支都不建，不留建了一半的状态（实测 git 2.43）。
5. **Rename…**：`git branch -m 旧名 新名`，当前分支也行（实测）。输入框标题 `Rename branch feat`，预填旧名并全选；校验同新建；与旧名相同即取消。
   上游照 git 默认随改名带过去（仍跟踪原来的远程分支），远程分支不跟着改名，也不进需求池。
6. **Delete**：
   - 本地分支（非当前），同 IDEA：先 `git branch -d`。已合并的直接删、不确认，状态栏 `Deleted branch feat (was 1a2b3c4)`（短 hash 留着找回）；
     未合并（`not fully merged`）弹原生模态确认 `feat has commits that are not merged anywhere. Delete it anyway?`，按钮 `Delete`，确认后 `-D`。
     删除后带「Restore」的通知进需求池。
   - 远程分支：`git push origin --delete feat`，每次都弹模态确认 `Delete feat on origin? This removes it for everyone using the remote.`。网络操作，走远程道与进度出口。
     本地与远程在 `Ref` 里是不同类型，菜单命令拿到带类型的节点，不会删错。
   - 删掉的正是选中的分支：分支树整理后选中自动落空，Pull / Push 随之置灰。
7. **提示文字先用 git 原文，以后统一处理**（需求池）：这一阶段不写自己的错误文案与完成消息。
   - 切换被挡（`error: Your local changes to the following files would be overwritten by checkout:`）、被别的 worktree 占用：git 原文，走错误关口。
   - 删除的完成消息直接用 `git branch -d` 自己的输出（`Deleted branch feat (was 1a2b3c4).`）。
   - 只有 git 不会说的才自己写：确认框里的问题（删除未合并的分支、删除远程分支）、git 不报错但要提醒的情况（检出远程分支时同名本地分支已分叉）。
   - 第 3 阶段已有的几句（推送被拒、不能快进等）先保留，统一处理时一起收拢。
8. **Stash 模式**（同 IDEA Commit 工具窗口的 Stash 页）：
   - 顶部 Commit / Stash 切换栏接上；下面一行是 Stash 模式自己的工具栏（第 9、10 条）。
   - 中间一棵树，每个 stash 一个顶层组：标题是 git 生成的说明（`WIP on main: 1a2b3c4 fix login`，一键存不问名字），右侧灰字时间（与 Log 同一写法，共用 `logic/utils/time.ts`）；组下是它改了的文件，按目录整理，无复选框。默认全部收起；最新的在最上。
   - 双击文件打开 diff：左存 stash 时的基础提交，右 stash 里的版本，都是历史版本、只读。
   - 底部（Amend、说明、Commit）在 Stash 模式下隐藏。没有 stash 时正中灰字 `No stashes`。
   - 存了未跟踪文件的 stash：那部分在附属提交（第三个父提交）里，和已跟踪的合在一棵树里，显示为新增 `A`；diff 左边为空。文件列表都用 Log 的 `getCommitFiles`（已跟踪的问 stash 本身、对第一个父提交；未跟踪的问附属提交），扩展只新加一条 `getStashes`。
   - 同一个文件可以在好几条 stash 里，树节点 id 前面加 stash 的 hash。
9. **存 stash 在 Commit 模式**：工具栏 Rollback 旁加 **Stash** 按钮（codicon `archive`），说明用 git 自动生成的，不问名字。有改动就能点：
   - 勾了文件（提示 `Stash Selected`）：`git stash push -u -- <勾选的文件>`，改名的带上旧路径（同提交）。勾选里有已暂存的删除时先 `git restore --staged` 退回成未暂存（`tech/traps.md` 第 1 节）；代价是 Apply 回来改名显示成新增 + 删除两行。
   - 什么都没勾（提示 `Stash All`）：`git stash push -u`，存全部改动。
   - 永远带 `-u`：勾了未跟踪文件也一起存、取出时还原；没勾的（不管跟踪与否）原样留下（实测 git 2.43）。不分情况，逻辑最简单。
   - 存了未跟踪文件的 stash，那部分在附属提交 `stash@{n}^3` 里，`git stash show` 看不到；Stash 模式列文件时两部分合在一起。
   - 本地写操作，走本地道与进度出口；完成消息用 git 自己的输出。
10. **Stash 模式**：工具栏只有 **Apply**（应用选中的 stash，保留它）与 **Delete**（删掉选中的 stash，原生模态确认）。
    Stash 的右键菜单：Pop、Apply ｜ Delete（Pop = Apply 成功后删掉；最常见，排最前）。
    选中 stash 那一行或它下面的文件都算选中这条。Apply 图标是 `AppIcon.Unstash`，Delete 是 codicon `trash`。
    完成消息：Apply / Pop 自己写（`Applied …`、`Applied and dropped …`，git 的输出是一整段 status），Delete 用 git 的 `Dropped stash@{n} (…)`。
    Apply / Pop 冲突时这一阶段显示 git 原文；以后转进合并界面（需求池）。
11. **进度出口**：Checkout、New Branch（`switch -c`）、Stash 存 / Apply / Pop、删除远程分支走进度出口（改工作区或联网，可能要几秒）；Rename、删除本地分支、删除 stash 不走（只改一个引用，立刻看得见）。
    完成消息用 git 自己的输出（`Switched to branch 'feat'`、`Saved working directory and index state …`、`Deleted branch feat (was 1a2b3c4).`——最后这句不走进度出口，直接一条状态栏消息）；git 不说话的（Rename）不显示。

## 二、实现顺序

每步一个概念，`pnpm check` 通过、手动看过、用户确认后单独提交。

1. **原生右键菜单的骨架 + 命令注册关口**（tech/architecture.md 第 15 题）：树节点可以带一份「右键菜单上下文」，`Tree.vue` 写成 `data-vscode-context`。菜单是协议的第二个入口：菜单命令用同一张参数校验表把 context 校验成协议命令的参数 → 调同一个 handler → 出错交给错误关口。第一个菜单项：本地分支的 Checkout（协议命令 `checkout`，`git switch`，走进度出口）。
2. **Checkout 远程分支**：第 3 条那张表的五种情况。
3. **New Branch from Here…**：原生输入框带校验（`check-ref-format`、重名），`switch -c 新名 --no-track 起点`。
4. **Rename…**：预填旧名的输入框，`branch -m`。
5. **Delete**：本地分支（`-d`，未合并时确认后 `-D`）、远程分支（确认后 `push --delete`，走远程道）；删掉的正是选中的分支时选中落空。
6. **Commit 模式的 Stash 按钮**：`stash push -u -- <勾选的文件>`。
7. **Stash 模式的列表**：切换栏接上；列出全部 stash（git 的说明 + 时间），展开看文件（含 `^3` 里的未跟踪文件），双击看 diff。
8. **Stash 的 Apply / Delete 按钮与右键菜单**（Pop、Apply ｜ Delete）。
9. **验收**：「要核对的条目」逐条勾过；验收句手动走一遍；`pnpm check`；本文状态改为完成。
