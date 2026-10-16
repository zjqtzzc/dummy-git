# 第 12 阶段细节：操作日志

状态：完成（2026-10-16）。核对清单逐条勾过；验收句手动走一遍（成功、被拒、刷新、外部改动）；`pnpm check` 通过（657 个测试）。
验收句：出事以后，看「输出」里的 Dummy Git 就能还原：在什么环境、谁从哪个入口做了什么、确认框问了什么答了什么、跑了哪些 git 命令（含 stderr）、结果是什么、哪一步慢。

结束标志：`pnpm check` 通过，验收句手动走一遍成立，下面「要核对的条目」逐条勾过。

## 零、要核对的条目

需求（`product/roadmap.md` 第 12 阶段）：
- [x] 启动与找到仓库时记运行环境（`logEnvironment`、`logRepository`）
- [x] 每个操作记开头与结尾；git 命令与问答带同一编号（`Operations`、`loggedUi`；编号跨 await、并发不串、问答有测试）
- [x] stderr 照记；超过 1 秒标慢（`briefGitCommand`，有测试）
- [x] 刷新记一行；webview 的异常记进来（`logRefresh`、`reportError`，`Operations.context` 与 `report` 有测试）

`tech/architecture.md`：
- [x] 第 15 题（错误关口）：git 拒绝关口不再写（命令行那行已有 stderr），已知情况 warn、bug error 带调用栈；关口在操作里调用，带编号（第 15 题原文已改，有测试）

## 一、需求从哪来（2026-10-16）

| 场景 | 这次碰到的 | 要的信息 |
|---|---|---|
| 「不是我做的」 | stash 被删 | 时间、入口、确认框的问答 |
| 界面显示不对 | stash 展开为空（`getCommitFiles` 返回空，日志只有 `exit 0`） | 每个请求的结果摘要 |
| 只在用户机器上出 | 容器里的 git 2.25 | 运行环境 |
| git 有额外输出 | setlocale 警告 | stderr |
| 慢、卡、挂住 | — | 用时；开头那行（挂住时没有结尾） |
| 并发刷新穿插 | 贴来的日志里几次刷新交错 | 每行属于哪个操作；刷新的起因 |
| webview 报错 | — | 现在只进 webview 自己的开发者工具 |

参照（源码里核对过）：VS Code git 用 `LogOutputChannel`，启动记 `Using git "版本" from "路径"`，每条命令 `> git … [ms]`，stderr 每次都记，stdout 只记 `git.commandsToLog` 点名的；
GitLens 跟随 VS Code 的日志级别（自己的 `outputLevel` 已废弃），每次调用一个范围编号带父编号，超过 500ms 标 slow 且不受级别限制；
IDEA 的 git 命令记在 debug，超过 10 秒升到 info，有一键打包日志。

## 二、细节（逐条定）

1. **一个概念：操作**（已定，2026-10-16）
   - 操作 = 一条协议命令从入口进来到返回。入口只有两个：Router 收到 webview 请求、右键菜单命令。两处都调同一个 `runOperation`，handler 不改。
   - 每个操作两行：开头（编号、入口、命令、全部参数）与结尾（结果摘要或错误、用时）。不并成一行：挂住时只有开头那行能看出卡在哪。
   - 操作里发生的事都带它的编号：问用户的问答、状态栏完成消息、git 命令。编号用 `AsyncLocalStorage` 传，入口设一次。
   - 结果摘要是通用规则，不为每条命令建表：数组记条数，字符串记原文，`null` 不记，对象记字段名。
   - 「取消」不单列：确认框那行写着答了什么。
2. **入口只记到「哪块页面 / 哪个菜单命令」**（已定）：同一页面里同一条命令几乎只有一个按钮发；先呼出界面再执行的（右键 `Push…` → 对话框里 Push）就是两次操作，按时间相邻。不记父子关系，不加 `trigger` 字段。
3. **分级：按出没出问题，不按读写**（已定，2026-10-16 用户定）
   - error：我们的 bug（错误关口收到的意外异常、webview 的异常、解析失败）；warn：git 拒绝（`GitFailureError`）、超过 1 秒；info：其余全部，**读请求也在 info**；debug：只放我们内部的事（router 丢弃消息、换代、监听的原始事件）。
   - 理由：`LogOutputChannel` 默认级别是 info，低于它的行不显示、也不写进日志文件。stash 展开为空那次的问题就在一个读请求上，放 debug 就丢了。
   - 否决按频率或读写分级：要一张表、要判断，量也不大（一次刷新十来行）。
4. **git 命令行**（已定）：带操作编号；stderr 全文照记（同 VS Code git）；stdout 不记（进池子）。
5. **慢**（已定）：操作或 git 命令超过 1 秒，行尾标 `(slow)` 并记 warn。否决 GitLens 的 500ms（偏敏感）与 IDEA 的 10 秒（太宽）。
6. **刷新**（已定）：监听广播域变化时记一行（哪些域）；当时有我们的写操作在跑或刚跑完，写上它的编号。不追到之后的每个读请求（按时间就挨着）。
7. **环境**（已定）：启动时与找到仓库时各记一次：扩展版本、VS Code 版本、远程类型（`vscode.env.remoteName`）、系统、git 路径与版本、仓库根目录与 git 目录、给 git 设的 locale。
8. **webview 的异常**（已定）：`report()` 与 `window.onerror` / `unhandledrejection` 发一条单向消息，记 error，带上是哪块页面。
9. **不脱敏，但要精简**（2026-10-16 用户定）：日志里出现的数据（参数、结果、stderr、git 参数）都过同一个 `brief()`，规则只有四条：
   - 字符串：多行的只留第一行，后面注 `…（共 N 行）`；单行超过 120 字截断，注 `…（共 N 字）`。
   - 数组：前 3 项，后面注 `…（共 N 项）`；结果里的数组只记条数。
   - 对象：只展开一层，里面的值按上面两条。
   - stderr：前 5 行，注 `…（共 N 行）`。
   - git 命令行：前 12 个参数（选项都在前面），后面注 `…（共 N 个参数）`；`--format=` 照旧折叠。
   - hash、路径、分支名这些单个标识不缩短：事后要拿完整 hash 找回东西（这次 stash 就是从日志里的完整 hash 找回的）。

不做（进池子）：stdout、一键导出、纯界面点击、按钮级来源。

## 三、实现

```
Router.dispatch(来源 = 这块页面) ─┐
menuCommand.run(来源 = 菜单 id)  ─┴→ runOperation(log, 来源, 命令, 参数, () => handler(参数))
                                     ├ #编号进 AsyncLocalStorage，记开头
                                     ├ handler 里：ui.* 经记录外壳 → 问答、完成消息
                                     │             GitCli → GitLogger（vscode 层实现，行首加编号）
                                     └ 记结尾：摘要 / 错误 + 用时，超时标 slow
```

| 地方 | 做什么 |
|---|---|
| `vscode/logger.ts` | 建 `LogOutputChannel`，给出带级别的 `Log`；`GitLogger` 的实现在行首加当前编号。`git/` 不知道编号 |
| `ipc/operation.ts`（新） | `runOperation`、编号、摘要规则。只依赖 node，可单测 |
| `ipc/router.ts`、`vscode/menu.ts` | 原来的「用时」行换成 `runOperation`；Router 建时传入来源名 |
| `HandlerUi` 的记录外壳（新） | 问用户的方法记问答；`withProgress`、`notify` 记完成消息 |
| `git/cli.ts` | 日志行加 stderr 与 slow |
| `extension.ts` | 环境 |
| 监听 | 刷新那行 |
| 协议、webview | `logError` 单向消息 |

## 四、实现顺序

每步一个概念，`pnpm check` 通过、手动看过、用户确认后单独提交。

1. **频道与环境**：换成 `LogOutputChannel`，现有的行先都记 info；启动与找到仓库时记环境。
2. **操作**：`runOperation` 接两个入口，开头 / 结尾两行，编号经 `AsyncLocalStorage`，git 行带编号。测试：编号跨 `await` 还在、并发两个不串、失败那行、摘要规则。
3. **问答**：`HandlerUi` 的记录外壳。测试：确认框的问答记下了。
4. **stderr 与慢**：git 行加 stderr；操作与 git 命令超过 1 秒标 slow、记 warn。测试：stderr 出现在日志里、超时标记。
5. **刷新**：监听那行，带当时的写操作编号。
6. **webview 的异常**：`logError`。
7. **验收**：核对时发现错误关口与 G 节不一致（git 拒绝记 error、stderr 写第二遍、不带编号），随验收一并改。
