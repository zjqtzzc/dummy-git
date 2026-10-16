# 第 3 阶段细节：和远程同步

状态：完成（2026-10-08）。核对清单逐条勾过；验收句手动走一遍；`pnpm check` 通过（408 个测试）。
验收句：Log 面板左边的按钮区点拉取，能快进就快进，不能快进就显示 git 的报错；点推送，把当前分支推到唯一的远程，新分支自动带 `-u`。左栏分支显示 ahead/behind。不 merge，不 rebase，不 force push；新分支要选远程而无法判断（多个远程且没有 origin）时报错。

结束标志：`pnpm check` 通过，验收句手动走一遍成立，下面「要核对的条目」逐条勾过。

## 零、要核对的条目

需求（`product/roadmap.md` 第 3 阶段）：
- [x] 分支栏左边一条竖的按钮区：Fetch、Pull、Push；Fetch 顺带清掉远程已删除的分支
- [x] 拉取：能快进就快进，不能就显示 git 的报错
- [x] 推送选中的本地分支到它跟踪的远程分支；新分支第一次推送自动带 `-u`；多个远程时用 origin，没有就报错
- [x] 左栏分支旁显示 ahead/behind
- [x] 耗时操作让人看见「正在做 / 做完了」
- [x] 推送被拒时显示 git 的报错
- [x] 要账号密码或 SSH 口令时直接报错，不等待：用扩展注入的环境实测 HTTPS 认证 1.5 秒失败、SSH 主机指纹确认 0.9 秒失败

`tech/architecture.md`：
- [x] 第 12 题：网络命令不占写队列；推送新分支是组合命令（查 upstream → `push -u`）
- [x] 第 15 题已知错误：拉取不能快进、推送被拒、选不出远程、没有上游（`UserFacingError`）；需要账号密码（第 6 阶段前显示 git 原文）
- [x] 第 12 题：两条道（`LockPolicy.Remote`）；第 15 题旁的进度出口

`tech/traps.md` 第 1 节第 3 阶段的几条：拉取遇未提交改动（git 原文）、新分支无 upstream（自动 `-u`）、`fetch --prune`（有测试）、推送失败要进通知（错误关口）——都已覆盖。

## 一、交互细节（逐条定）

**已定**
1. **按钮位置**：三个按钮都在 Log 面板分支树左边的竖按钮区，从上到下 Fetch、Pull、Push，同 IDEA 的 Log 窗口。图标自己画（`webview/src/ui/icons.ts`，codicon 没有斜向箭头）：Fetch 虚线 ↙、Pull 实线 ↙、Push 实线 ↗。Commit 面板不放同步操作。第 4 阶段的新建 / 删除分支以后加进同一条竖区。
   提示文字写明作用对象：`Fetch`、`Pull Selected`、`Push Selected`。
2. **拉取**：针对分支树里选中的本地分支 `B`（HEAD 那行即当前分支），上游 `origin/M`。只动 `B` 和 `origin/M`，不碰别的分支，不带 `--prune`。
   - `B` 不是当前分支：一条 `git fetch origin M:B`。不带 `+`，只允许快进；不碰工作区与暂存区，不占写锁。
   - `B` 是当前分支：`git fetch origin M`，再 `git merge --ff-only origin/M`（git 不允许 fetch 直接更新检出的分支）；只有 merge 占写锁。
   - `B` 没有上游：不跑命令，提示「这个分支没有跟踪的远程分支」。
   - 选中的不是本地分支（远程分支、目录、分组、没选）：Pull 置灰。
   - 不能快进、工作区改动挡住：这一阶段显示 git 报错；以后所有冲突类操作都转进合并界面（需求池）。
3. **推送**针对选中的本地分支 `B`（只有一个远程 `origin`）。网络命令，不占写锁。
   - 有上游 `origin/M`：`git push origin B:M`，写明推哪个到哪个，与是否当前分支、`push.default` 都无关。
   - 没有上游：`git push -u origin B`，推到同名并设为上游（组合命令：先看分支数据里有没有上游，不另跑命令）。
   - 上游已删（`[gone]`）：照样 `push origin B:M`，在远程重建。
   - 被拒绝：这一阶段显示 git 报错，以后转进合并界面。不 force push。只推分支，不推 tag。
   - 选中的不是本地分支：Push 置灰。
4. **推送目标**：一个推送入口 `push(分支)`，先由一个单独的函数算出默认目标（「推到哪个远程的哪个分支」，只是值），再执行。
   顺序：**上游 → 唯一的远程（同名分支，带 `-u`）→ `origin`（同名，带 `-u`）→ 报错**（多个远程且没有 `origin`、或没有远程：需要选远程，目前不支持）。
   - 拉取只看上游，有几个远程都照常执行。
   - 没有上游时才跑 `git remote`（刚加上、还没 fetch 过的远程下面没有分支，不能从分支列表推断）。
   - Fetch：`git fetch --all --prune`，取全部远程。
   - 以后改成弹窗（同 IDEA：推送前总弹对话框，默认目标可改，没有远程时给「定义远程」）：只换入口，用同一个函数算出默认目标填进对话框。推送对话框在需求池。
   - 拉取不猜：没有上游就报错（猜错会把无关的同名分支快进进来，不易察觉）。
5. **ahead / behind**：本地分支名后面，同 IDEA：蓝色 `↙6`（落后，`AppIcon.Pull` 的 ↙，`--vscode-charts-blue`）、绿色 `↗50`（领先，`AppIcon.Push` 的 ↗，`--vscode-charts-green`），图标与数字同色。
   - 只显示不为 0 的一边；同步时不显示；没有上游不显示；上游已删显示灰色 `gone`；远程分支不显示。
   - 和本地记录的远程分支比，Fetch 之后才准。数据 `getRefs` 已有。
   - 画法只在分支树里；`Tree.vue` 只在说明位置加一个可选的具名插槽。以后有第二处要用这类标记，再提出共同部分。

6. **并发与「正在做」**（tech/architecture.md 第 12、15 题已同步）：
   - **两条道**：每仓库本地道（现有写队列）+ 远程道（新增，所有网络命令），各自串行、互不等待。`LockPolicy` 加 `Remote`。网络操作之间不再撞引用锁，正确性不靠按钮置灰。
   - **进度出口**（`vscode/` 层，与错误关口对称，注入给 handler）：handler 声明「这一段是什么」与「做完了怎么说」；进行中状态栏转圈加文字，结束后几秒的完成消息（`Pushed zzc-dev → origin/zzc-dev`、`Fetched all remotes`、`zzc-dev is up to date`）；失败走错误关口。
   - **按钮不转圈、不置灰**（除了「选中的不是本地分支」时 Pull / Push 置灰）：连点只是在远程道里排队。`Repository` 不记「进行中的操作」，没有消费者；以后面板需要时再加。

7. **已知错误**（tech/architecture.md 第 15 题）：命令层认出，作为带 `kind` 的结果返回；handler 换成一句话交给错误关口弹通知，git 原文照旧全写进输出面板。
   不直接显示原文，是因为关口只显示 stderr 第一行，而 push 被拒时第一行是 `To github.com:…`，原因在后面几行。
   | 情况 | 通知 |
   |---|---|
   | 拉取不能快进 | `Cannot fast-forward zzc-dev: it and origin/zzc-dev have both changed. Merging is not supported yet.` |
   | 推送被拒 | `Push rejected: origin/zzc-dev has commits that zzc-dev doesn't have. Pull first.` |
   | 拉取的分支没有上游 | `zzc-dev has no upstream branch. Push it first.` |
   | 推送选不出远程 | `Cannot choose a remote for zzc-dev: the repository has several remotes and none is named origin.` / `…: the repository has no remotes.` |
   | 工作区改动挡住拉取 | git 原文（第一行已说清楚） |
   | 要账号密码 | git 原文（第 6 阶段再处理） |

8. **Fetch 只手动**：不定时、打开面板也不自动跑（VS Code、IDEA 默认都不自动）。以后会要自动 Fetch（需求池）；远程道已保证它不和手动 Pull / Push 撞。

## 二、实现顺序

每步一个概念，`pnpm check` 通过、手动看过、用户确认后单独提交。

1. **两条道**：`LockPolicy` 加 `Remote`，`CommandQueue` 每仓库两条链。测试：两条远程命令并发时依次执行；远程道在跑时本地道不等它。
2. **Fetch 端到端 + 进度出口**：git 命令 `fetch --all --prune`（`Remote`）；协议 `fetch`；`vscode/progress.ts`（状态栏转圈加完成消息），作为 `HandlerUi` 注入；Log 面板分支树左边的竖按钮区，先放 Fetch。
3. **分支树的选中交给 Log 面板**：选中的是本地分支就给出分支名（是不是当前分支、上游是什么由扩展执行时自己问 git）；竖按钮区加上 Pull / Push，选中的不是本地分支时置灰（点了暂时没反应）。
4. **拉取**：非当前分支 `fetch origin M:B`；当前分支 `fetch origin M` + `merge --ff-only origin/M`（拆开，各进各的道）；没有上游、不能快进两种已知错误，以及「handler 给错误关口一句话」的做法。
5. **推送**：算默认目标的纯函数（上游 → 唯一远程 → `origin` → 报错，配测试）；`git remote`；`push origin B:M` / `push -u origin B`；推送被拒、选不出远程两种已知错误。
6. **ahead / behind**：`Tree.vue` 在说明位置加一个可选的具名插槽；分支树用它画蓝 `↙` 绿 `↗` 与 `gone`。
7. **验收**：「要核对的条目」逐条勾过（含网络命令要密码时直接报错）；验收句手动走一遍；`pnpm check`；本文状态改为完成。

## 三、留给后面的阶段

- **冲突都转进合并界面**（需求池）：拉取不能快进、推送被拒现在只给一句说明；第 7 阶段的 rebase / merge 与以后的合并界面接手。
- **推送对话框**（需求池）：入口换成弹窗，默认目标仍由 `core/pushTarget.ts` 算。
- **自动 Fetch**（需求池）：远程道已保证不和手动操作撞。
- **「进行中的操作」**：面板需要知道谁在跑时（比如第 7 阶段的横幅），在 `Repository` 加集合与域，进度出口改由它驱动。
- **需要账号密码**：第 6 阶段把 askpass 空回答换成弹输入框；那时「签名要密码」「没配用户名邮箱」的提示一起做（tech/architecture.md 第 15 题）。
- **图标**：`logic/icons.ts` 一张表；新图标加一行，新尺寸在 `Icon.vue` 加一档。

