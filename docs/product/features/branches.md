# 分支

> Log 面板左栏的分支树：显示什么、能对分支做什么、为什么这样做。改分支相关的行为或代码前先读本文；行为变了就改本文。
> 同步（Fetch、Update、Push）见 `product/features/sync.md`；合并、变基的过程与冲突见 `product/features/conflicts.md`。

## 分支树

- 顶上一行 HEAD：在分支上时写 `HEAD → <分支>`，detached 时写 `HEAD (detached at <短 hash>)`。
- 下面两组 `Local`、`Remote`。Remote 先按远程名分，两组里的分支名都按 `/` 折叠成目录。每层按名字排序，目录在前。不显示 `origin/HEAD`：它只是指向远程默认分支的指针，不是分支。
- Local 默认展开，当前分支加粗；Remote 展开到远程名，下面的目录默认折叠。展开状态存在 webview 的 `setState` 里，重新加载窗口后还在。
- **ahead / behind**（同 IDEA）：本地分支名后面，蓝色 `↙6` 是落后，绿色 `↗50` 是领先，图标和数字同色。只显示不为 0 的一边；完全同步、没有上游、远程分支都不显示；上游在远程已被删除时显示灰色 `gone`。比较的是本地记录的远程分支，所以 Fetch 之后才准。
- 单击只选中；**双击或回车**按这个分支过滤 Log（HEAD 那行是当前分支），见 `product/features/log.md`；Ctrl+C 复制分支全名，多选时一行一个（`product/features/trees.md`「复制」）。
- 选中的节点跟着分支数据走：节点没了（比如删掉了选中的分支），选中就落空，依赖它的按钮随之置灰。

## 竖按钮区

分支树左边一条竖的按钮区，从上到下：**New Branch from Selected**、**Update Selected**、**Delete Selected**、**Fetch**（同 IDEA 的 Log 窗口），隔开一点再是全部展开、全部收起（同 Commit 面板工具栏，2026-10-20 项目负责人提；展开状态照样存进 `setState`）。前三个作用于分支树里选中的节点，选中的东西不适用时置灰。Commit 面板不放同步操作。
- 竖按钮和右键菜单用同一份菜单项定义（`logic/log/branchTree.ts` 的 `NEW_BRANCH`、`UPDATE_BRANCH`、`DELETE_BRANCHES`）：算不出就置灰，算出来的就是请求的参数，规则只有一份。确认框由扩展弹。
- Push 不放在这里，只在右键菜单（项目负责人定）：推送会影响别人，也比 Update 用得少。

## 右键菜单

用 VS Code 原生的右键菜单：`package.json` 的 `webview/context`，右键时按选中算好每个菜单项、写在树的容器上（`tech/decisions.md`「右键菜单：每个菜单项一个键」；菜单项定义在 `logic/log/branchTree.ts`）。外观和键盘操作（菜单键、Shift+F10、Esc）都是原生的，省去自己画菜单要踩的坑（超出视口、滚动、失焦）。菜单命令和 webview 的请求共用同一张参数校验表、同一个 handler、同一个错误出口。

不可用的项**不出现**（`when` 条件），不置灰。多选或右键目录、分组时只有 Update（`product/features/sync.md`）和 Delete（见下），其余几项都只能对一个分支做。按「由轻到重」分组，组之间有分隔线：

| 节点 | Checkout | Update、Push…、Merge into Current、Rebase onto This | New Branch from Here…、Rename… | Delete |
|---|---|---|---|---|
| 本地分支（不是当前分支） | ✓ | ✓ | ✓ | ✓ |
| 当前分支（含 HEAD 行） | — | Update、Push… | ✓ | —（git 不许删当前分支） |
| 远程分支 | ✓（见下） | Merge、Rebase | New Branch | ✓（删远程） |
| HEAD 行（detached） | — | — | New Branch（从当前提交） | — |
| 目录、分组、远程名 | — | — | — | 目录、`Local` 组：下面的分支全都能删时（见下）；远程名、`Remote` 组没有 |

## Checkout

统一用 `git switch`：`checkout` 还兼管恢复文件，参数有歧义；而且旧的 `checkout` 不检查有没有操作停在半路，`switch` 会检查。

- 本地分支 `B`：`git switch B`。
- 远程分支 `origin/feat`：本地名用 `Ref` 里不带远程前缀的 `name`，不拆字符串。

  | 情况 | 做法 |
  |---|---|
  | 本地没有 `feat` | `switch -c feat --track origin/feat` |
  | 本地 `feat` 跟踪 `origin/feat`，一样或领先 | 切到本地 `feat` |
  | 同上，本地落后 | 切过去并快进：`switch feat` + `merge --ff-only origin/feat`（用本地记录，不联网） |
  | 同上，分叉 | 只切过去、不动它，状态栏提示 `feat and origin/feat have diverged` |
  | 本地 `feat` 跟踪的不是它，或没有上游 | 不切，提示 `A local branch named feat already exists and doesn't track origin/feat.` |

- 工作区有改动：不冲突时 git 会带过去，不拦；冲突时 git 拒绝，显示 git 原文。被别的 worktree 占用时同样显示 git 原文。
- 走进度出口；完成消息用 git 自己的那句（`Switched to branch 'feat'`）。

## 新建、改名、删除

**New Branch from Here…**（右键）和 **New Branch from Selected**（竖按钮）是同一条命令，起点由同一个函数算出：本地分支、远程分支，或 HEAD 行（当前提交）。
- 名字用 VS Code 原生输入框（标题 `New branch from origin/feat`，默认为空），边输入边校验：用 `git check-ref-format --branch` 判断是否合法，再对照分支列表判断是否重名。不合法时输入框下面写原因，确定按钮点不了。
- 建完直接切过去：`git switch -c 新名 --no-track 起点`，同 IDEA 新建分支对话框里默认勾上的「Checkout branch」。
- 带 `--no-track`：从远程分支建时，git 默认会让新分支跟踪起点，之后一推送就推到别人的分支上去了。不跟踪的话，第一次推送会推到同名分支并设为上游。
- 工作区改动挡住时，`switch -c` 连分支都不会建，不会留下建了一半的状态（git 2.43 实测）。

**Rename…**：`git branch -m 旧名 新名`，当前分支也能改（git 允许）。输入框标题 `Rename branch feat`，预填旧名并全选，校验同新建；和旧名相同就当作取消。上游照 git 的默认随改名带过去，远程分支不跟着改名。只改一个引用，不走进度出口；git 不输出东西，所以也没有完成消息。

**Delete**：
- 本地分支（同 IDEA）：先 `git branch -d`。已合并的直接删、不确认，状态栏显示 git 那句 `Deleted branch feat (was 1a2b3c4).`，短 hash 留着方便找回。没合并的（`not fully merged`）弹原生模态确认 `feat has commits that are not merged anywhere. Delete it anyway?`，按钮 `Delete`，确认后用 `-D`。
- 远程分支：`git push origin --delete feat`，每次都弹模态确认 `Delete feat on origin? This removes it for everyone using the remote.`。这是网络操作，走远程道和进度出口。
- 本地分支和远程分支在 `Ref` 里是不同的类型，菜单命令拿到的是带类型的节点，不会把远程删成本地。
- **一次删好几个**（多选，或右键目录、`Local` 组，2026-10-20 项目负责人定）：一条 `deleteBranches`，规则和删一个完全一样，只看删的是什么、不看删几个（同 IDEA：批量删除就是把单个删除循环一遍）。
  - **全部严格**：选中的、目录展开后的，每一个都要能删（不是当前分支的本地分支、远程分支），有一个不能删 Delete 就不出现。所以里面有当前分支的目录、分组没有 Delete，Ctrl+A 之后也没有。
  - **远程名、`Remote` 组不给 Delete**：删掉一个远程上的全部分支等于替所有人清空它；远程名下面的目录照常能删。
  - 先删本地、再删远程。本地每个分支各一条 `branch -d`，状态栏各说一句 git 那句，日志里每个分支的 `(was <hash>)` 都在。没合并的收在一起问一次（`3 branches have commits that are not merged anywhere. Delete them anyway?`，说明里列出前 5 个名字），取消就留着它们、接着问远程。远程的收在一起问一次（`Delete 2 branches on remotes? …`），每个远程一条 `git push <远程> --delete <分支>…`。删了不止一个时，最后状态栏说 `Deleted 5 branches`。
  - 不加「删不止一个时先总问一次」：同一个删除会因个数不同而表现不同。代价：右键一个全是已合并分支的目录点 Delete，会不提醒直接全删，只能从日志里找回。
- 删除后不弹带 Restore 的通知（`product/never.md`）。

## Merge、Rebase

本地分支（非当前）和远程分支的右键菜单里有 **Merge into Current**（`git merge <分支>`）和 **Rebase onto This**（把当前分支变基到它，`git rebase --autostash <分支>`）。不弹确认。停在冲突时怎么继续、怎么放弃，见 `product/features/conflicts.md`。

## 以后可能做（`product/backlog.md`）

检出远程分支时，如果同名本地分支和它分叉了，照 IDEA 让用户选「把本地 rebase 到远程上」还是「丢弃本地、用远程的」。
