# 经验与坑

> 做某个阶段、某个组件前先查这里。只留对当下仍有用的；踩平了、在结构上不可能再发生的，只留一句结论。

## 1. 各阶段会碰到的 git 坑

| 阶段 | 坑 | 结论 |
|---|---|---|
| 3 | 拉取遇到未提交的改动会失败 | 第 3 阶段只快进、失败显示 git 报错；带 `--autostash` 的拉取在需求池 |
| 3 | 新分支推送没有 upstream | 第一次推送自动带 `-u` |
| 3 | `fetch` 只拉当前远程 | 拉所有远程并 `--prune`（第 3 阶段只支持一个远程，多个直接报错） |
| 3 | 推送失败只打印到控制台，用户看不到 | 失败一律走错误关口的通知 |
| 4 | 重命名**当前**分支 | git 2.43 实测允许，不用特殊处理（有测试） |
| 4 | 删除远程分支跑成删本地 | 远程分支走专门的删除；`Ref` 把 remote / name 分开存，远程与本地在类型上就分得开 |
| 4 | 从远程分支 checkout 时本地分支名的推导 | 去掉远程名前缀，不按斜杠猜 |
| 4 | 删除当前正在过滤 / 选中的分支后面板不刷新 | 删除后按 refs 域刷新，选中与过滤要能落空 |
| 4 | `stash push -u -- <路径>` 里有**已暂存的删除**（改名的旧路径、`git rm` 过的）：先存下 stash，再在清理时报 `pathspec did not match` 退出——stash 建了、改动还在工作区（git 2.43）；不带 `-u` 则直接拒绝。只传新路径又剩下 `D` | 先 `restore --staged` 把它们退回成未暂存的删除再 stash（`handlers.ts` 的 `stash`，有测试）。IDEA（Staging Area 模式）与 GitLens 都只传新路径，留下 `D` |
| 4 | `stash push -- <路径>` 存进去的是**整个暂存区**：没勾的已暂存改动（新增、改名、删除）一起进 stash，同时还留在工作区，Apply 时再来一遍（git 2.25、2.43 实测；2026-10-16 用户碰到） | `stashPaths` 先 `write-tree` 记下暂存区，把没勾的已暂存路径退回，stash 完（失败也）从那棵树还原（有测试）。否决：自己用 `commit-tree` 造 stash（等于重写 `git stash`）；有别的暂存改动时拒绝（常见用法用不了）；`stash push --staged`（语义不同，要 2.35） |
| 4 | `git stash drop` / `pop` 只认 `stash@{n}`、不认 hash（`is not a stash reference`），而序号随存、删而变：拿界面上的序号去删可能删错一条 | 界面与协议一律用 hash；drop / pop 在同一条本地道命令里先按 hash 找当前序号再执行（`commands/stash.ts`，有测试）。`apply` 认 hash |
| 7 | merge、cherry-pick、revert 进行中，`commit --only -- 路径` 和 `--amend` 被 git 拒绝（git 2.43 实测） | 见 `phases/phase-07.md` A5 |
| 7 | rebase 停下时 git 允许 amend，但改到的是上一条已经重放好的提交 | 见 A5 |
| 7 | 冲突解决后、继续之前，git 允许 stash push 和回滚：解决好的内容被存走或丢掉，`MERGE_HEAD` 还在 | 已知，不处理 |
| 7 | merge、cherry-pick、rebase 的 `--continue` 可能打开编辑器等用户写说明，从扩展里调用会一直卡住 | 用 `-F` 或 `GIT_EDITOR` 把说明框的内容传进去 |
| 7 | stash pop 冲突时不删除 stash | 解决后要自己删 |
| 7 | `ORIG_HEAD`、`AUTO_MERGE` 在 abort 之后仍然留着 | 不能用它们判断有没有操作在进行 |
| 7 | 合并编辑器一打开，结果栏就是「未保存」的草稿（没处理的冲突用基准占位，两边都新增的为空）；替用户关它时，用户若在 VS Code 的关闭提示里勾过「不再询问」，就直接保存，冲突标记被基准内容覆盖而 git 仍认为是冲突 | 不主动关合并编辑器，也不替用户保存（`vscode/mergeEditor.ts`） |
| 7 | 旧的 `checkout` 不检查进行中的操作，`switch` 会检查 | 我们用的是 `switch`，不用处理 |
| — | 在 VS Code 的终端里跑 `pnpm check`，环境里带着 VS Code 自己的 `GIT_ASKPASS`（及 `VSCODE_GIT_IPC_HANDLE` 等）：`cli.test.ts` 的「没给脚本：直接失败」会去问 VS Code 的 askpass，十几秒后成功返回而失败，还可能在 VS Code 里弹一次输入框（2026-10-15 发现） | 暂不处理（用户定）。临时绕开：`env -u GIT_ASKPASS -u VSCODE_GIT_IPC_HANDLE … pnpm check`。待想：扩展不传脚本时也会继承宿主环境的 `GIT_ASKPASS`，测试与 `GitCli` 是否该清掉它 |
| — | git 2.31 之前（如 Ubuntu 20.04 的 2.25），`log --first-parent --name-status` 对 merge 提交**输出为空、退出码 0**；2.31 起 `--first-parent` 才顺带给 merge 出 diff。stash 也是 merge，于是容器里的 Stash 页展开是空的，用户以为没存上把它删了（2026-10-16） | `-m --first-parent` 一起用，两个版本输出一致（`parsers/nameStatus.ts`）。测试只在 2.43 上跑，测不出这种版本差异；最低版本定的是 2.23，老版本上的行为要另外验证 |
| — | git 2.25 的 `check-ignore`（不带 `--verbose`）把被 `!` 否定规则重新纳入的文件也报成「忽略」（2.43 不报），于是监听把这些文件的改动当成忽略、面板不刷新（2026-10-16 在 2.25 上跑测试发现） | 带 `--verbose`，命中的规则以 `!` 开头的不算忽略（`commands/checkIgnore.ts`，两个版本实测；现有测试在 2.25 上会红）|
| — | git 2.26 之前 rebase 默认走 apply 后端，状态目录是 `rebase-apply/` 而不是 `rebase-merge/` | 读状态、写说明两处都认两个目录（`operationState.ts`、`operation.ts`），测试也两个都认 |
| — | 进程层强制 `LC_ALL=en_US.UTF-8`，没装这个 locale 的系统（如只有 `C.UTF-8` 的 Ubuntu 容器）上，git 调起的 shell（钩子、`/bin/sh` 是 bash 时）在 stderr 第一行打 `setlocale: LC_ALL: cannot change locale`，我们取「git 说的第一句」时取到的是它 | Linux 改用 `C.UTF-8`（C locale 下 git 不翻译，照样英文），macOS、Windows 照旧（`cli.ts` 的 `LOCALE`；`pnpm test:old-git` 的容器里有判别力的测试）|
| 9 | 撤销某个提交里一个文件的改动 | 按文件在该提交里的状态分三种：新增 → 删除文件；删除 → 从父提交恢复；修改 / 改名 → 改回父提交内容。一律 `checkout <hash>~1 -- <path>` 在新增文件上会报 `pathspec did not match` |

同一个形状出现过多次：**把一个动作当成单一操作，而正确做法取决于文件的状态。**
所以动作层必须能看到文件的状态（`FileChange` 保留暂存区与工作区两列、`CommitFileChange` 带 status）。

已在结构上消除、不会再发生的：`status` 回写 index 引起刷新回路（`GIT_OPTIONAL_LOCKS=0`）；提交前无差别 `add`（只对未跟踪文件 `add`）；
`origin/HEAD` 与带斜杠本地分支被当成远程（`Ref` 建模）；根提交不显示文件（`log --name-status` 不引用父提交，也不需要 `--root`）；
锁冲突报错只显示误导性的第一行（`RepositoryIsLocked`）；面板启动焦点竞态（ready 握手，不用延时）。

## 2. 面板刷新

后台刷新（watcher 驱动）会不停发生，比如被忽略的日志文件持续写入。每个面板都要满足：

1. **用户状态与数据分离。** 勾选、展开、滚动位置、草稿不是从 git 来的，就不该被 git 的刷新碰到——不是「刷新后恢复」，是「根本不在刷新的路径上」。
2. **后台刷新不显示进度。** 只有用户主动触发的操作才显示「正在做」。「进度条最短显示时长」只适用于用户操作，套在后台刷新上会把 20 ms 看不见的闪变成 300 ms 明确可见的闪。
3. **不自己实现 gitignore 匹配**（见 `tech/decisions.md`「刷新」）。

`git status -uall` 在有两万个被忽略文件的工作区里仍 < 10 ms：git 在目录级就判定忽略。代价不在 CPU，在界面被反复重画。

**长写命令途中，面板会显示半截状态（已知，暂不修）。** 大仓库切分支超过 1 秒时，防抖的最长等待（`MAX_WAIT_MS`）
在 git 写到一半时触发刷新，`status` 不排队，读到半新半旧的工作区，Commit 面板一下冒出大量「已修改」，git 写完后的那次刷新再恢复。
最终状态正确，只是闪一下。Stash 存 / Apply / Pop 同理。
修法：本地道有写命令在跑时只记下变化、不通知，命令结束后通知一次（IDEA、VS Code 自带的 Git 都这么做）；
要放宽「刷新只由 watcher 驱动」（`core/repository.ts` 的 `run()`），外部终端的操作仍会闪。

## 3. 组件的坑

一个组件被很多功能复用，坑要在组件里一次修对，不要修在各个功能上。

| 组件 | 坑 |
|---|---|
| 右键菜单 | 超出视口、菜单过长要滚动、失焦要关闭 |
| tooltip | 要渲染在最外层、靠边时自动翻转 |
| 输入框 | webview 里 `Cmd+A` 可能失效 |
| 快捷键 | 与用户装的 IntelliJ 键位插件冲突 |
| 进度条 | 见上面第 2 节 |

## 4. 做事的教训

- **问「没有它会怎样」，不问「为什么要有它」。** 前者才是判据；后者总有答案，因为它在参照实现里确实有用。
- **守卫要让它失败一次（变异确认）。** 凡是断言「某类错误不可能发生」的守卫——类型约束、结构性质、完备性检查——
  验收时把它该拦的东西放进去，确认它真的红。一个守卫只锁一件事；「漏」和「多」这类不同方向分别验。
- **环境类问题先要日志，不从代码猜。** 现象涉及跑起来的环境（宿主、容器、远程、权限、路径）时，推理的输入全是二手的，
  拼出的自洽故事和真相长得一样。
- **测试验得了「链路通不通」，验不了「人找不找得到」。** 注册命令、挂菜单、放按钮不能依赖任何前置条件成功，
  跑不了时由它自己说清楚原因；每阶段验收要真人点一遍入口。
- **demo 验行为，`pnpm check` 验类型，不能互替**：esbuild 只剥类型不检查。
- **测量会推翻直觉**，用我们自己的代码测，不用 shell 近似。
