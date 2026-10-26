# 停在半路的操作与冲突

> merge、rebase、cherry-pick、revert 这类会停在半路的操作，以及冲突怎么显示、怎么解决、怎么继续或放弃。改这块的行为或相关代码前先读本文；行为变了就改本文。
> 入口：分支右键的 Merge、Rebase（`product/features/branches.md`）；提交右键的 Cherry-Pick、Revert、Rebase onto Here（`product/features/log.md`）；Update 分叉时的 Rebase / Merge（`product/features/sync.md`）。

## 操作

| 入口 | 做法 |
|---|---|
| 分支右键 Merge into Current | 把它合进当前分支，说明由我们给（`-m`），不打开编辑器 |
| 分支右键 Rebase onto This | 把当前分支变基到它，带 `--autostash` |
| 提交右键 Cherry-Pick（可多选） | 一串 hash 从 stdin 按从旧到新交给 git，不改说明（`--no-edit`） |
| 提交右键 Revert（可多选） | 同上，按从新到旧 |
| 提交右键 Rebase onto Here | 把当前分支变基到这条提交，带 `--autostash` |

命令行见 `git/commands/index.ts`（`mergeRef`、`rebaseOnto`、`replayCommits`）。

- **不弹确认**（同 IDEA）：出事了可以放弃。
- 工作区有改动时：merge、cherry-pick、revert 交给 git 处理，不冲突时带着改动做，冲突时 git 拒绝、显示原文。rebase 加 `--autostash`：git 先把改动存起来，结束后再取回。
- 完成消息：`Merged feature`、`Fast-forwarded to feature`、`Rebased onto feature`、`Already up to date`；停下时 `Stopped for conflicts`；rebase 做完了、但取回改动时冲突，写 `Rebased onto feature. Applying the stashed changes has conflicts.`。
- cherry-pick 一个合并提交时，git 会拒绝（要求 `-m`），显示 git 原文。多选里有合并提交时菜单里没有 Cherry-Pick、Revert：git 在一串里碰到它会报错退出，前面的已经摘过来，只留下 `.git/sequencer`，面板看不出有操作在进行，git 却认为有（git 2.43 实测）。
- **一串 cherry-pick、revert**：整串交给 git 的 sequencer，停在冲突时继续接着做剩下的，放弃回到整串开始之前（已经摘过来的一起撤掉）。用 stdin 不用参数：Windows 的命令行最长 32767 个字符，八百来个 hash 就超了。
- **变空自动跳过**（同 IDEA）：某条的改动当前分支里已经有了，git 会停下来，而且这时继续过不去。我们自动 `--skip`、接着做下一条，完成消息写上跳过了几条：`Cherry-picked 2 commits, skipped 1 already applied`，全跳过了写 `Skipped 1 already applied`（revert 是 `already reverted`）。两种的说法不一样，要分开认：cherry-pick 在 stderr 写 `is now empty`、留着 `CHERRY_PICK_HEAD`；revert 在 stdout 写 `nothing to commit`、不留 `REVERT_HEAD`，一串时只剩 `.git/sequencer`，单条时什么都不留。解决冲突时留了当前分支那一边、点继续后变空的，同样跳过、接着做剩下的（2026-10-19 项目负责人定：留当前分支那一边就是不要这一条了；照 git 报错的话继续永远过不去，只能放弃整串），完成消息是 `Cherry-pick completed, skipped 1 already applied`。
- 完成消息：一条写短 hash（`Cherry-picked 1a2b3c4`），多条写条数（`Cherry-picked 3 commits`）。
- 不管操作是谁发起的（包括用户在终端里执行的 merge），面板都一样显示。
- 要签名口令的 rebase、cherry-pick，照旧显示 git 的报错（输入密码在第 6 阶段）。

## 面板的四种情况

Commit 面板只问两件事：有没有停下的操作（读状态文件，不跑 git）；有没有冲突文件（`git status` 里的未合并条目）。组合出四种，由 webview `logic/` 里的一个纯函数算出：

| | 没有冲突文件 | 有冲突文件 |
|---|---|---|
| **没有停下的操作** | ① 平常的样子 | ② 只有冲突组，没有按钮（比如 stash 取出时冲突、rebase 取回改动时冲突） |
| **有停下的操作** | ④ 只有标题行，继续可点，并高亮 | ③ 标题行 + 冲突文件，继续不可点 |

- **冲突组**在最上面，叫 `Conflicts`，文件没有复选框，文件后面用灰字写冲突类型。
- **标题行**：③ `Merging feature · 2 conflicts  [»] [×]`，» 不可点，悬停提示先解决冲突；④ 组里没有文件了，标题行照常显示；② `Conflicts · 2`，没有按钮。» 用绿色，× 用红色，都取主题里的语义颜色。
- **继续（»）**：把说明框的内容写进 git 准备说明的那个文件（各种操作、rebase 的两个后端各不相同，见 `git/commands/operation.ts` 的 `messageFile`），再以 `GIT_EDITOR=true` 执行 `--continue`。否则 `--continue` 可能打开编辑器等用户写说明，从扩展里调用就会一直卡住。
- **不自动继续**：最后一个冲突解决之后，只把 » 高亮，由用户自己点。
- **放弃（×）**：先弹确认（`Abort the merge?` 等），确认后执行对应操作的 `--abort`。
- **Commit 与 Amend 锁住**：情况③④下两者都不可用，用同一个条件。merge、cherry-pick、revert 进行中时，`commit --only -- <路径>` 和 `--amend` 本来就会被 git 拒绝；rebase 停下时 git 虽然允许 amend，改到的却是上一条已经重放好的提交。情况②不受影响：stash 冲突时用 `commit --only` 提交其它文件能成功（实测）。
- **说明框**：进入③④的那一刻，Amend 取消勾选、Commit 与 Amend 锁住，说明框直接覆盖成 git 准备的说明。写到一半的草稿不保留（项目负责人定：写到一半去 merge 很少见，不值得为它多维护一份状态）。同一次停下，不会覆盖你改过的字。操作结束（继续成功或放弃）后清空说明框，和提交成功后一样。
- 读状态文件时，rebase 两个后端的目录都认：git 2.26 起默认是 merge 后端（`rebase-merge/`），之前是 apply 后端（`rebase-apply/`）。`ORIG_HEAD`、`AUTO_MERGE` 在 abort 之后还会留着，不能拿它们判断有没有操作在进行。

否决过：
- 顶部横幅：顶部只放 Commit / Stash 切换；继续能不能点取决于冲突，按钮放在冲突旁边，关系最直接。
- IDEA 的模态冲突弹窗：webview 做不出能放文件列表的模态框；另开一个页面，又会和冲突组重复。IDEA 自己也在改成在文件树里显示冲突。
- 最后一个冲突解决后自动继续：用户就没有机会再看一眼说明。
- 「Commit 按钮直接变成继续」（VS Code 的做法）：继续已经在标题行，两个控件不该回答同一个问题。
- 「Amend 不管」：勾着 Amend，说明框会换成上一次提交的说明，继续时就拿错了说明。
- `git ${kind} --continue` 这种拼接写法（GitLens 的做法）：枚举值不拼进命令行，继续与放弃各用一张「操作 → 命令」的表。

## 解决冲突

| 冲突 | 双击 | 右键 |
|---|---|---|
| 两边都改了、两边都新增了 | 打开合并编辑器 | Open in Merge Editor ｜ Open File ｜ Mark as Resolved |
| 一边删了、一边改了，只有一边新增了 | 弹选择：Keep / Delete File（问题写明是哪一边删的） | Open File ｜ Keep ｜ Delete File |
| 两边都删了 | 弹选择：Delete File | Delete File |

- **合并编辑器**用 VS Code 自带的（内部命令 `_open.mergeEditor`）。三栏都从暂存区取：基准 `:1`，左边 Current `:2`，右边 Incoming `:3`，输出是工作区里的文件。五种冲突（merge、rebase、cherry-pick、revert、stash 取出）都会把三栏写进暂存区，所以只有一条路；改名时各栏已经是 git 对好路径的内容。
  - 否决 VS Code 自带 git 扩展的做法（左右取 `HEAD` / `MERGE_HEAD` 或 `REBASE_HEAD` 的提交）：要按操作分别去找对方是哪个文件，cherry-pick、revert、stash 最后还得退回暂存区。
  - 栏的标题：左边 `Current` 加当前分支名；右边 `Incoming` 加 merge 对方的分支名、cherry-pick 与 revert 的短 hash，stash 冲突写 `Stashed Changes`。rebase 时也不对调左右，一律左 Current、右 Incoming，标题里写清楚。
  - **不主动关合并编辑器，也不替用户保存**：合并编辑器一打开，结果栏就是「未保存」的草稿（没处理的冲突用基准占位，两边都新增的为空）。如果替用户关掉它，而用户曾在 VS Code 的关闭提示里勾过「不再询问」，就会直接保存，冲突标记被基准内容覆盖，git 却仍然认为有冲突。
- **Mark as Resolved**：文件里还有冲突标记（行首的 `<<<<<<<`、`=======`、`>>>>>>>`）时，先确认 `<文件> still contains conflict markers. Mark as resolved anyway?`；然后 `git add`，文件移出冲突组。Keep 就是标记已解决，留下工作区里的那份。
- **多选、选冲突组**（2026-10-20 项目负责人定）：Mark as Resolved、Keep、Delete File 作用于选中的全部（一条 `git add` / `git rm`），全部严格，种类混着就没有这一项；Open in Merge Editor 只能单选（同 IDEA 的 `GitConflictActions.kt` 能多选，但 IDEA 有列出多个文件的合并窗口，VS Code 的合并编辑器一次开一个）。一批 Mark as Resolved 里还有冲突标记的收在一起问一次（`2 files still contain conflict markers. Mark them as resolved anyway?`，列出名字），取消就只是它们不标记，其余照旧标记。Keep、Delete File 不问。
- 冲突解决后、继续之前，git 允许 stash push 和 Rollback，解决好的内容会被存走或丢掉，而 `MERGE_HEAD` 还在。git 不拦，我们也不拦。
