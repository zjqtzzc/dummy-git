# 操作日志

> 「输出」面板里的 Dummy Git 记了什么、为什么这样记、在哪里实现。规则（写日志时必须遵守的）在仓库根的 `CLAUDE.md` G；截断上限与慢的阈值只在 `packages/extension/src/ipc/brief.ts` 开头。日志的行为变了就改本文。

## 给谁用

出事以后用：用户把「输出」→ Dummy Git 里的一段贴出来，就能还原发生了什么。
- 运行环境（只在某些机器上出的问题，多半出在这里）；
- 谁从哪个入口做了什么、参数是什么；
- 确认框问了什么、用户答了什么；
- 跑了哪些 git 命令、git 在 stderr 里说了什么；
- 结果是什么，哪一步慢；
- 仓库为什么刷新了；
- webview 里有没有报错。

一段典型的日志：
```
10:02:11.402 [info]  #41 dummyGit.dropStash → dropStash {hash: "c560c8f80bcc…"}
10:02:11.455 [info]  #41 > git stash list -z --format=... [29ms] exit 0
10:02:13.180 [info]  #41 确认「Delete the stash "WIP on develop: …"? This cannot be undone.」 → Delete
10:02:13.229 [info]  #41 > git stash drop stash@{0} [38ms] exit 0
10:02:13.230 [info]  #41 状态栏「Dropped stash@{0} (c560c8f…)」
10:02:13.231 [info]  #41 ✓ 1829ms
10:02:13.480 [info]  刷新：stash（#41 在 249ms 前结束）
```

## 记了什么

- **运行环境**：启动时记扩展版本、VS Code 版本、远程类型（`vscode.env.remoteName`：dev-container、ssh-remote、wsl…）、系统、git 版本与路径、给 git 设的 locale；找到仓库时记根目录与 git 目录（linked worktree 时还有共享目录）。
- **操作**：一条协议命令从入口进来到返回。入口有三个：webview 的请求、右键菜单命令，以及自动 Fetch 这类后台任务（入口写「自动」）。每个操作两行：
  - 开头：`#编号 来源 → 命令 {参数}`。来源是视图 id（`dummyGit.commit`、`dummyGit.push`…），或者菜单命令 id（`dummyGit.dropStash`），一看就知道是哪块页面、还是右键菜单。参数里不记 `repo`：现在只有一个仓库，找到时已经记过一次。
  - 结尾：成功 `#编号 ✓ 用时 → 结果摘要`（列表只记条数），失败 `#编号 ✗ 用时 错误`。
  - 不并成一行：挂住的操作只有开头那行，能看出卡在哪。
- **操作里发生的事**都带上它的编号：
  - 问用户的问答：确认框、选择框、输入框、通知上的按钮，记下问题和回答（包括「取消」「关掉」）；
  - 状态栏消息、进度出口的完成消息、复制的内容；
  - git 命令：`> git <参数> [用时] <结局>`，有 stderr 时在下面缩进附上。stdout 不记，它可能是几 MB 的 log 或文件内容。
- **刷新**：仓库一变，记一行哪些域过期了，以及当时的操作情况：有哪些操作正在跑、上一个操作多久前结束。文件监听有防抖，分不清一次刷新是哪个操作引起的，所以只写这些事实，不猜。之后各页面重新拉数据的请求，按时间就挨在这一行后面。
- **webview 的异常**：页面里 `report()` 到的、没被接住的（`window` 的 `error`、`unhandledrejection`）、Vue 组件里抛的，都经协议命令 `reportError` 送到扩展，记成 error，附上调用栈。请求失败不送：扩展那边已经记过了。送的过程本身失败，就只留开发者工具里那一份，不再报一遍，免得来回打转。
- **错误出口**：我们的 bug 记 error 并附调用栈；已知的情况记 warn；git 拒绝的不另写，git 命令那一行已经有 stderr，操作结尾也记了。错误出口在操作里调用，所以也带编号。

## 为什么这样

- **只有一个新概念「操作」**，其余都挂在现成的出口上：三个入口共用 `Operations.run`，问答走 `HandlerUi` 的记录外壳，git 命令走 `GitLogger`。几十个 handler 一个都没改。
- **级别按出没出问题分，不按读写**：`LogOutputChannel` 默认级别是 info，低于它的行不显示，也不写进日志文件。stash 展开为空的那次，问题就出在一个读请求上，放在 debug 就丢了。否决按读写或按频率分级：要维护一张表、要做判断，而量本来就不大（一次刷新十来行）。
- **入口只记到页面、菜单命令或「自动」，不记是哪个按钮**：同一个页面里，同一条命令几乎只有一个按钮会发。先呼出界面、再执行的（右键 `Push…` → 对话框里点 Push）就是两次操作，按时间相邻。否决记父子关系、请求带 `trigger` 字段、把刷新精确追到是哪个写操作引起的：要改几十个调用点，或者只能靠猜。
- **不脱敏，但精简**（项目负责人定）：日志里出现的数据都过 `brief()`，按统一的上限截断多行、长行、长列表、长 stderr、长命令行。单个标识（hash、路径、分支名）不缩短：误删的 stash 就是靠日志里的完整 hash 找回来的。
- **慢的标出来**：操作或 git 命令超过阈值，行尾标 `(slow)` 并记 warn。参照：GitLens 是 500ms（偏敏感），IDEA 是 10 秒（太宽）。
- **参照**（源码核对过）：VS Code git 用 `LogOutputChannel`，启动时记 `Using git "版本" from "路径"`，每条命令 `> git … [ms]`，stderr 每次都记；GitLens 每次调用一个范围编号、带父编号；IDEA 有一键打包日志。

## 在哪里

| 做什么 | 在哪 |
|---|---|
| 频道（`LogOutputChannel`）、git 命令写成一行、环境、仓库位置、刷新那行 | `vscode/logger.ts` |
| 操作：编号、`AsyncLocalStorage`、开头与结尾、当时的操作情况 | `ipc/operation.ts` |
| 精简规则与全部上限、慢的阈值 | `ipc/brief.ts` |
| 问答与完成消息 | `ipc/loggedUi.ts` |
| git 层交出的一条命令的记录（参数、用时、结局、stderr） | `git/cli.ts`、`git/types.ts` |
| webview 的异常 | `webview/src/logic/client.ts` 的 `report`、`webview/src/main.ts` |
