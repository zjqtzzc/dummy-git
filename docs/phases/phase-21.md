# 第 21 阶段细节：按文件取回 stash

状态：验收中（2026-10-28；888 个测试在 git 2.43 与 2.25 上通过，本机另有一个签名测试因环境失败、与本阶段无关；验收句已在 code-server 里走过，见下）。
验收句：Stash 模式里选中一条 stash 下的几个文件，右键 Apply Selected Files，只有这些文件的改动回到工作区，stash 保留；和 HEAD 冲突时进冲突组。

结束标志：`pnpm check` 通过，验收句手动走一遍成立，下面「要核对的条目」逐条勾过。

## 零、要核对的条目

需求（`product/roadmap.md` 第 21 阶段）：
- [x] stash 下的文件（目录等于下面全部）右键有 Apply Selected Files；选中跨了两条 stash、或含 stash 那一行时没有。测试：`stashTree.test.ts` 的 `stashMenuContext`。手测（code-server + Playwright，`everyday` 场景）：stash 行菜单是 Pop、Apply、Rename…、Delete；三个文件、目录 `notes/` 右键只有 Apply Selected Files；跨两条 stash、stash 行混着文件时都没有。
- [x] 只取回选中的：已跟踪的（含改名、删除）与未跟踪的；没选的不动，stash 保留。测试：`stash.test.ts` 的 `applyStashFiles` 前三条、`handlers.test.ts` 的 Apply Selected Files。手测：选 take.txt、moved.txt（改名）、new.txt（未跟踪）后取回，`git status` 只多出这几项，keep.txt、skip.txt 不动，stash 仍是 3 条，状态栏 `Applied selected files from On main: pick`。
- [x] 和 HEAD 冲突、被本地改动挡住时，表现与整条 Apply 相同。测试：`stash.test.ts` 的 `applyStashFiles` 后两条。手测：f.txt 取回后 `UU f.txt`、Commit 面板冲突组里有它、stash 留着，与整条 Apply 同一条 stash 的结果一样；改过的 take.txt 再取回，通知 git 的 `would be overwritten`，文件不变。

`tech/architecture.md`：没有第一次用到的题目。
- [x] 第 12 题「组合命令」的清单加上了这一条。

## 一、交互细节（逐条定）

1. **入口：stash 下文件的右键菜单**（已定，2026-10-28）
   - 名字 `Apply Selected Files`。IDEA 叫 `Cherry-Pick Selected Changes`（`Vcs.ApplySelectedChanges`，和 Log 详情里的文件右键共用一个动作）；我们 stash 那一行已经叫 Apply，沿用这个词。
   - 展开看、全部严格：目录等于它下面列出的全部文件；都要属于同一条 stash。选中里含 stash 那一行时没有这一项，整条用那一行的 Apply。
   - 只在右键菜单。工具栏 Apply 仍取回整条：选中 stash 下的文件也算选中这条 stash（现在的规则）。
   - 走进度出口 `Applying files from stash…`，完成消息 `Applied selected files from <说明>`（整条 Apply 也是自己写的，git 的输出是一整段 status）。

2. **只做 Apply，不做按文件 Pop**（已定，2026-10-28）
   - 同 IDEA：文件右键只有取回，stash 保留。
   - 按文件 Pop 要重写那条 stash、剔掉取走的文件，进 `product/backlog.md`。

3. **做法：拼一条只含选中文件的临时 stash，交给 `git stash apply`**（已定，2026-10-28，git 2.43 实测）
   - 已跟踪的：在临时暂存区（`GIT_INDEX_FILE`）里读进存时所在的提交，选中的路径换成 stash 里的样子（stash 里没有的就删掉：删除、改名的旧路径），写成一棵树。
   - 选中了未跟踪文件：另一棵只含它们的树，做成第三个父提交（git 认 stash 的未跟踪部分就靠它）。
   - 第二个父提交（存时的暂存区）用原来那条的：不带 `--index` 时 git 不读它。
   - 临时提交不 `stash store`，不进列表，之后由 gc 回收。原来那条 stash 不动。
   - 冲突、被挡住都是 `git stash apply` 自己的行为，与整条 Apply 一样：和 HEAD 冲突时进暂存区（`UU`），冲突组接住；本地未暂存改动碰到同一文件时 git 拒绝，报的错和整条 Apply 一样。
   - 否决 `git restore --source=<stash> -- <路径>`：直接覆盖，本地改动丢掉，存完以后 HEAD 上的改动也被悄悄撤掉。
   - 否决 `git diff <存时的提交> <stash> -- <路径> | git apply`：有一块对不上就整份失败，不留冲突标记；加 `--3way` 又要求文件和暂存区一致，有未暂存改动就报 `does not match index`（2.43 实测）。
   - 否决照 IDEA 自己打补丁：它打不上时弹自己的合并窗口，我们没有自己的合并界面（`product/backlog.md`「自建合并界面」）。
   - 和 `product/features/stash.md` 里否决的「自己用 `commit-tree` 造 stash 提交再 `stash store`」不同：那条是存，等于重写 `git stash push`；这里只造给 `apply` 用的临时提交，取回的逻辑仍是 git 的。

4. **git 的一个行为，不处理**（已定，2026-10-28）
   - 整条或部分取回被本地改动挡住（`Your local changes … would be overwritten`）时，未跟踪的那部分已经写进工作区，git 不收回（2.43 实测）。
   - 这是 git 自己的行为，整条 Apply 现在就会遇到；要不要处理进 `product/backlog.md`。

## 二、实现顺序

每步一个概念，`pnpm check` 通过后单独提交。

1. **git 命令 `applyStashFiles`**：交出命令与命令表一行。测试：只取回选中的、stash 保留；未跟踪的只取回选中的；改名两头一起；删除；和 HEAD 冲突进暂存区；被本地改动挡住时报错、stash 不动。
2. **协议、校验与菜单命令**：`applyStashFiles`（仓库、stash 的 hash、已跟踪路径、未跟踪路径，至少一个），handler 走进度出口；`MenuContextKey.ApplyStashFiles` 与 `package.json`。测试：校验表。
3. **页面**：stash 树的菜单目标改成 tagged union（stash 那一行、已跟踪文件、未跟踪文件），加 Apply Selected Files。测试：`stashMenuContext` 的出现条件与参数。
4. **验收**：「要核对的条目」逐条勾过；验收句手动走一遍；开一个新的子代理，只给它这个阶段的 diff，让它找出漏改的文档和能删的东西，列成清单交项目负责人定（`process/workflow.md` §2「结束」）；本文状态改为完成。
