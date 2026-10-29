# 和远程同步：Fetch、Update、Push

> 取回、更新分支、推送（含推送对话框），以及为什么这样做。改这几样的行为或相关代码前先读本文；行为变了就改本文。
> 入口都在 Log 面板：分支树的竖按钮区和分支右键菜单（`product/features/branches.md`）。分叉之后的变基、合并与冲突见 `product/features/conflicts.md`。

## 共同的

- **按钮不转圈、不置灰**（选中的不适用时除外）：网络命令在同一条道里依次执行、和本地写命令互不等待（`tech/architecture.md` 第 12 题），连点只是排队，不会撞引用锁。进度在状态栏：进行中状态栏的分支项转圈（`product/features/branches.md`「状态栏」），结束后显示几秒完成消息（`Fetched all remotes`、`Pushed feat → origin/feat`、`feat is up to date`）；失败走错误出口。
- **要账号密码或 SSH 口令时直接报错，不等**（为什么、怎么做见 `tech/architecture.md` 第 16 题）。实测 HTTPS 认证 1.5 秒失败，SSH 主机指纹确认 0.9 秒失败。弹框让人输入在第 6 阶段做（`product/roadmap.md`）。
- 提示文字先用 git 原文。只有 git 第一行说不清楚的才自己写一句，比如推送被拒：第一行是 `To github.com:…`，原因在后面几行。

## Fetch

竖按钮区的 **Fetch**：取全部远程（`--all`），带 `--prune`，顺带清掉远程上已经删除的分支。

**自动 Fetch**（2026-10-22 项目负责人定：远程状态要自己跟上）：仓库打开后先跑一次，之后每次跑完隔一段固定时间再跑（`core/autoFetch.ts` 的 `AUTO_FETCH_INTERVAL_MS`，取 IDEA 的默认间隔）。同 IDEA 勾上「Fetch remote changes automatically」时（`GitBranchIncomingOutgoingManager.java:249-255`，启用时先跑一次，再 `scheduleWithFixedDelay`；间隔是注册表 `git.update.incoming.info.time`，默认 20 分钟）；IDEA 默认不勾，我们默认开。
- **不带 `--prune`**：远程上删掉的分支，本地的记录留到手动 Fetch 时再清，后台不替用户删东西（项目负责人定）。和手动的是同一条命令（`fetchAll` 的 `prune` 参数），走远程道排队，不和手动 Fetch、推送撞。
- 不转圈、不进状态栏；失败只记日志（`ErrorGate.logOnly`），不弹通知。要密码的远程本来就直接失败（`tech/architecture.md` 第 16 题），后台不会弹密码框；IDEA 是同样的效果：远程还没认证成功过时用不认证的模式跑（`getAuthenticationMode`）。
- 日志里是一个操作，入口写「自动」。跑完远程分支的记录变了，refs 过期，ahead / behind 与 Log 的远程标签自己刷新。
- 开关和间隔先写死：项目还没有设置项，以后一起放进设置（`product/backlog.md`）。不做 IDEA 的 `ls-remote` 模式（只看远程分支指向哪、不取提交），也不做手动 Fetch 后推荐开启自动的提示。

## Update

**Update Selected**（竖按钮）和分支右键的 **Update** 是同一条命令，作用于选中的本地分支 `B`（HEAD 那行就是当前分支），它的上游是 `origin/M`。只动 `B` 和 `origin/M`，不碰别的分支。
- 两步，命令行见 `git/commands/index.ts`（`fetchBranch`、`fastForward`）：
  1. 远程道：只取回 `origin/M`，更新远程分支记录，不碰 `B`。
  2. 本地道：快进 `B`。同一条命令里先看 `B` 此刻还在不在、是不是当前分支：是当前分支就 `merge --ff-only`，连工作区一起更新；不是就 `fetch . refs/remotes/origin/M:refs/heads/B`，只移动引用、不碰工作区（不带 `+`，只允许快进）。
- **写 `B` 放在本地道**，和删除、改名、Checkout 排队：取远程那几秒里它们都可能发生，取完再认一次才对。
  - 切走了：更新的仍是 `B`。若照第一步之前看到的当前分支跑 `merge --ff-only`，它认的是此刻的 HEAD，快进会打在切过去的那条上。
  - 删了或改了名：报 `Branch feat no longer exists.`，什么都不建。否决「一条 fetch 把 `origin/M` 直接取进 `B`、不占本地道」：fetch 走远程道，写引用时不管 `B` 刚被删掉，会新建一个 `B`，删掉的分支又回来，改名的多出一个（实测，退出码 0）。本地道只多占一次 `fetch .` 的毫秒，联网仍在远程道。
- 完成消息：动了就是 `Updated feat from origin/feat`，没动就是 `feat is up to date`。
- `B` 没有上游、或上游在远程已被删掉（`gone`）：菜单里没有 Update，竖按钮置灰（2026-10-20 项目负责人定）。不去猜上游：猜错了会把一个无关的同名分支快进进来，不容易察觉。万一按时上游刚被去掉，提示 `feat has no upstream branch. Push it first.`。
- **分叉时**：远程分支的记录已经取回来了，弹一条原生通知 `feat and origin/feat have diverged.`，两个按钮：
  - **Rebase**：把 `B` 变基到 `origin/M` 上（指名分支，不用先切过去）；
  - **Merge**：先切到 `B`（合并只改当前检出的分支），再合并 `origin/M`。
  - 都用刚取回的记录，不再联网。关掉通知就停在这里，本地分支不动。
  - 通知开着时用户可能切走了，所以不沿用更新前看到的「是不是当前分支」：Rebase 一律指名 `B`（`rebase <远程分支记录> B`），Merge 前再看一次 HEAD，不在 `B` 上就先切过去。不另加 Pull (Rebase)、Pull (Merge) 菜单项（项目负责人定：和 Update 按钮统一）。
- 工作区的改动挡住了：显示 git 原文。
- **一次更新好几个**（多选，或右键目录、`Local` 组，2026-10-20 项目负责人定）：
  - 展开看、全部严格：每一个都要能更新（配了上游、上游还在），有一个不行 Update 就不出现。所以 `Local` 组里只要有只在本地的分支，就没有 Update；远程分支、远程名、`Remote` 组都没有。
  - 按顺序逐个走上面的单分支 Update，算一次操作；每个分支状态栏各说一句，最后汇总 `Updated 2 branches, 1 already up to date, 1 diverged`（为 0 的不写）。
  - **分叉的不问**变基还是合并，跳过它接着做别的，做完报错 `2 branches have diverged from their upstream and were not updated: a, b. Update them one at a time.`，让人单个更新。否决挨个弹 Rebase / Merge 通知：通知要等人答，后面的分支都得卡着。IDEA 对非当前分支也只快进、分叉就报失败。
  - 某一个被 git 拒绝：已经更新的不撤回，剩下的不再做，显示 git 原文。
- **为什么叫 Update，不叫 Pull**（同 IDEA 的 Update Selected）：叫 Pull 会被当成 `git pull`，那是取整个远程、只作用于当前分支、按配置合并；IDEA 的 Pull 也是另一个带对话框的功能。界面、协议、git 层用同一个名字（按钮 `Update Selected`、右键 `Update`、请求 `update`、`git/commands/update.ts`），读代码不用多翻译一次。图标仍是 `AppIcon.Pull`：它描述的是箭头的形状，ahead / behind 标记也在用。

## Push

分支右键的 **Push…**（只在本地分支上）打开推送对话框，一律经过对话框，不直接推（同 IDEA）。竖按钮区没有 Push。对话框的外壳与通用行为见 `product/features/dialogs.md`。

**对话框里有什么**
- 标题 `Push <分支>`，下面一行说明。
- 目标一行：`<分支> → [远程 ▾] / [远程分支名]`。远程上还没有这个分支时，后面标 `New`（同 IDEA）。
- **默认目标**：上游 → `origin` → 第一个远程；没有上游时推到同名分支。上游在远程已被删除（`gone`）当作没有上游，也推到同名分支（同 IDEA：读跟踪关系时把远程分支已不存在的当过期、视为没有上游，`GitConfig.kt:215-219`；默认退到默认远程的同名分支，`GitPushSupport.java:95-104,126-139`）。对话框里看得见、改得了，所以不报错。
- **要推的提交**：说明、作者、日期三列，有最大高度、框内滚动，点了没反应。远程分支在本地有记录时，算 `refs/heads/<分支> --not refs/remotes/<远程>/<远程分支>`；没有记录时，算 `<分支> --not --remotes=<远程>`（同 IDEA）。改了远程或分支名就重算。最多列 1000 条，再多时标题写 `Commits (1000+)`：推到新远程时可能是整个历史，全取出来没有意义。为空时显示 `No commits to push`，Push 仍然可以点：force 时远程可能多出了提交。否决 IDEA 右边的文件列表：只排一列。
- **没有远程时**：远程下拉换成 `Name`（预填 `origin`）和 `URL` 两个输入框，点 Push 先 `git remote add -- <名字> <地址>`，再推送。否决 IDEA 另弹一个小对话框、OK 之前校验名字并用 `ls-remote` 试连：弹窗里再弹窗不好做；地址错了，推送时 git 自然会报；名字不合法、重名也交给 git 去报。

**推送**
- 写明推哪个到哪个（`<分支>:<远程分支>`），和是不是当前分支、`push.default` 都无关。改了远程分支名，不会动原来的上游。
- 没有上游、或上游已 `gone`：带 `-u`，推完上游就是刚推到的那个远程分支；不给勾选框。远程上已经有这个分支也设。和 IDEA 不同：IDEA 只在远程新建分支、且没有有效跟踪时带 `-u`（`GitPushTarget.java:84-90`），远程已有同名分支时不设上游；我们照设，推完就能 Update。
- **一起推 tag**（2026-10-23 项目负责人定：默认不推，不记住上次的选择）：提交列表下面一行，标签 `Tags`。勾选框 `Push tags`，后面一个下拉，没勾时置灰，选中项留着。
  - `All`（默认）：推本地全部 tag（`--tags`）。
  - `Current Branch`：只推这次推送够得着、远程还没有的附注 tag（`--follow-tags`）。旁边灰字 `Annotated tags only`。轻量 tag 留在本地，git 不提示（`tech/traps.md`）。
  - Push 和 Force Push 都看这一行。没勾就不带 tag。
- tag 被拒时分支已经推上去了（或本来就是最新），通知是这句结果再接 `, but tags were rejected: `，每个 tag 带上名字和 git 给的原因，例如 `Pushed main → origin/main, but tags were rejected: v1 [rejected] (already exists)`。Force Push 用 `--force-with-lease`，不覆盖远程已有的同名 tag（`tech/traps.md`）。
- 同 IDEA 推送对话框底部的选项（`GitPushOptionsPanel.java:32-75`，下拉是 `GitPushTagMode` 的 `All` / `Current Branch`，`GitPushTagMode.kt:22-25`）。和 IDEA 不同：IDEA 推完把这次的选择记下来，下次打开照着勾（`GitPusher.kt:50` 写 `GitVcsSettings.pushTagMode`）；我们每次打开都不勾。
- **点 Push 就关掉标签页**，推送在后台跑（同 IDEA），成功与失败都走现有的进度出口与错误出口。对话框没有「推送中」「失败后恢复」这些状态。
- 被拒：`Push rejected: origin/feat has commits that feat doesn't have. Update it first.`，git 原文写进日志。

**Force Push**
- 主按钮是拆分按钮 `[Push | ▾]`（`vscode-button-group`），`▾` 往上弹出一个浮层，里面是蓝色的 `Force Push` 按钮。浮层画在 webview 里，出不了标签页，所以往上开、右对齐；点了动作、点外面、按 Esc、webview 失焦都会收起。浮层写在 `PushApp.vue` 里，别处也要用时再抽。否决勾选框（项目负责人定）；否决 VS Code 原生菜单（试过能弹，但外观是右键菜单那种列表，项目负责人要的是弹出按钮）。
- 选了之后再弹一次原生确认（同 IDEA）：`Force push to origin/feat? It may overwrite commits at the remote.`，按钮 `Force Push`，另有取消。它藏在下拉里，选的时候看不到警告。取消时对话框留着。
- 用 `--force-with-lease`。lease 被拒照旧走错误出口；不做 IDEA 的「Force push anyway」（改用 `--force`）。
