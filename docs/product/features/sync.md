# 和远程同步：Fetch、Update、Push

> 取回、更新分支、推送（含推送对话框），以及为什么这样做。改这几样的行为或相关代码前先读本文；行为变了就改本文。
> 入口都在 Log 面板：分支树的竖按钮区和分支右键菜单（`product/features/branches.md`）。分叉之后的变基、合并与冲突见 `product/features/conflicts.md`。

## 共同的

- **两条道**：每个仓库有一条本地道（会改本地状态的写命令）和一条远程道（所有网络命令），各自串行，互不等待。网络操作之间因此不会撞引用锁，正确性不靠按钮置灰来保证。
- **按钮不转圈、不置灰**（选中的不适用时除外）：连点只是在远程道里排队。进度在状态栏：进行中转圈加文字，结束后显示几秒完成消息（`Fetched all remotes`、`Pushed feat → origin/feat`、`feat is up to date`）；失败走错误出口。
- **要账号密码或 SSH 口令时直接报错，不等**：`GIT_ASKPASS`、`SSH_ASKPASS` 指向一个只回空字符串的脚本，`SSH_ASKPASS_REQUIRE=force`，再加上 `GIT_TERMINAL_PROMPT=0`。git 停下来等人输入是最坏的故障：没有报错、没有退出码，没法诊断。实测 HTTPS 认证 1.5 秒失败，SSH 主机指纹确认 0.9 秒失败。弹框让人输入在第 6 阶段做（`product/roadmap.md`）。
- 提示文字先用 git 原文。只有 git 第一行说不清楚的才自己写一句，比如推送被拒：第一行是 `To github.com:…`，原因在后面几行。

## Fetch

竖按钮区的 **Fetch**：`git fetch --all --prune`，取全部远程，顺带清掉远程上已经删除的分支。只手动，不定时、打开面板时也不自动跑（VS Code、IDEA 默认都不自动）。

## Update

**Update Selected**（竖按钮）和分支右键的 **Update** 是同一条命令，作用于选中的本地分支 `B`（HEAD 那行就是当前分支），它的上游是 `origin/M`。只动 `B` 和 `origin/M`，不碰别的分支。
- `B` 不是当前分支：一条 `git fetch origin refs/heads/M:refs/heads/B`，不带 `+`，只允许快进；不碰工作区和暂存区，不占本地道。
- `B` 是当前分支：git 不允许 fetch 直接更新检出的分支，所以拆成远程道的 `git fetch origin refs/heads/M`，加本地道的 `git merge --ff-only origin/M`。
- 完成消息：动了就是 `Updated feat from origin/feat`，没动就是 `feat is up to date`。
- `B` 没有上游：不跑命令，提示 `feat has no upstream branch. Push it first.`。不去猜：猜错了会把一个无关的同名分支快进进来，不容易察觉。
- **分叉时**：远程分支的记录已经取回来了，弹一条原生通知 `feat and origin/feat have diverged.`，两个按钮：
  - **Rebase**：把 `B` 变基到 `origin/M` 上（指名分支，不用先切过去）；
  - **Merge**：先切到 `B`（合并只改当前检出的分支），再合并 `origin/M`。
  - 都用刚取回的记录，不再联网。关掉通知就停在这里，本地分支不动。不另加 Pull (Rebase)、Pull (Merge) 菜单项（项目负责人定：和 Update 按钮统一）。
- 工作区的改动挡住了：显示 git 原文。
- **为什么叫 Update，不叫 Pull**（同 IDEA 的 Update Selected）：叫 Pull 会被当成 `git pull`，那是取整个远程、只作用于当前分支、按配置合并；IDEA 的 Pull 也是另一个带对话框的功能。界面、协议、git 层用同一个名字（按钮 `Update Selected`、右键 `Update`、请求 `update`、`git/commands/update.ts`），读代码不用多翻译一次。图标仍是 `AppIcon.Pull`：它描述的是箭头的形状，ahead / behind 标记也在用。

## Push

分支右键的 **Push…**（只在本地分支上）打开推送对话框，一律经过对话框，不直接推（同 IDEA）。竖按钮区没有 Push。对话框的外壳与通用行为见 `product/features/dialogs.md`。

**对话框里有什么**
- 标题 `Push <分支>`，下面一行说明。
- 目标一行：`<分支> → [远程 ▾] / [远程分支名]`。远程上还没有这个分支时，后面标 `New`（同 IDEA）。
- **默认目标**：上游 → `origin` → 第一个远程；没有上游时推到同名分支。对话框里看得见、改得了，所以不报错。
- **要推的提交**：说明、作者、日期三列，有最大高度、框内滚动，点了没反应。远程分支在本地有记录时，算 `refs/heads/<分支> --not refs/remotes/<远程>/<远程分支>`；没有记录时，算 `<分支> --not --remotes=<远程>`（同 IDEA）。改了远程或分支名就重算。最多列 1000 条，再多时标题写 `Commits (1000+)`：推到新远程时可能是整个历史，全取出来没有意义。为空时显示 `No commits to push`，Push 仍然可以点：force 时远程可能多出了提交。否决 IDEA 右边的文件列表：只排一列。
- **没有远程时**：远程下拉换成 `Name`（预填 `origin`）和 `URL` 两个输入框，点 Push 先 `git remote add -- <名字> <地址>`，再推送。否决 IDEA 另弹一个小对话框、OK 之前校验名字并用 `ls-remote` 试连：弹窗里再弹窗不好做；地址错了，推送时 git 自然会报；名字不合法、重名也交给 git 去报。

**推送**
- 有上游：`git push <远程> <分支>:<远程分支>`，写明推哪个到哪个，和是不是当前分支、`push.default` 都无关。改了远程分支名，不会动原来的上游。
- 没有上游：带 `-u`，第一次推送顺带设好上游；不给勾选框。
- 上游在远程已被删除（`gone`）：照样推，在远程重建。
- 只推分支，不推 tag。
- **点 Push 就关掉标签页**，推送在后台跑（同 IDEA），成功与失败都走现有的进度出口与错误出口。对话框没有「推送中」「失败后恢复」这些状态。
- 被拒：`Push rejected: origin/feat has commits that feat doesn't have. Update it first.`，git 原文写进日志。

**Force Push**
- 主按钮是拆分按钮 `[Push | ▾]`（`vscode-button-group`），`▾` 往上弹出一个浮层，里面是蓝色的 `Force Push` 按钮。浮层画在 webview 里，出不了标签页，所以往上开、右对齐；点了动作、点外面、按 Esc、webview 失焦都会收起。浮层写在 `PushApp.vue` 里，别处也要用时再抽。否决勾选框（项目负责人定）；否决 VS Code 原生菜单（试过能弹，但外观是右键菜单那种列表，项目负责人要的是弹出按钮）。
- 选了之后再弹一次原生确认（同 IDEA）：`Force push to origin/feat? It may overwrite commits at the remote.`，按钮 `Force Push`，另有取消。它藏在下拉里，选的时候看不到警告。取消时对话框留着。
- 用 `--force-with-lease`。lease 被拒照旧走错误出口；不做 IDEA 的「Force push anyway」（改用 `--force`）。

## 以后可能做（`product/backlog.md`）

推送被拒后给 Rebase & Push / Merge & Push；提交右键 `Push All up to Here…`；推送 tag、Run Git Hooks 开关；在对话框里显示 force push 会覆盖掉的远程提交；自动 Fetch。
