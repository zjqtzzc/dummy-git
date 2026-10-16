# 架构考古笔记（来源：IntelliJ git4idea + platform/vcs-log|vcs-api|vcs-impl|dvcs-api|dvcs-impl）

> 目的：从 JetBrains 官方 Git GUI 的真实实现里抽取可信的架构判断，尤其是**底层 git 进程处理**的细节。
> 这是三份参照资料里覆盖最完整的一份：`jetbrains-git-graph` 只是模仿 IDEA 交互的 VSCode 插件，
> 不涉及 git 进程本身；这里是 IDEA **正主**的实现。
> 来源代码：`.notes/rebased-master`（从 IntelliJ Community 全量源码裁剪出的子集，
> 仅保留 git GUI 相关的 6 个模块，约 29M；**它不是独立 git 仓库，没有历史，是一次性下载物**，
> 引用的 file:line 只在当前这份快照里有效）。
> 对照物：`refs/vscode.md`（vscode/extensions/git @ 1.134.0）。

## 0. 规模与定位对比

| | vscode/extensions/git | git4idea (backend/src) | turtle_git 现状 |
| --- | --- | --- | --- |
| 进程层 | `git.ts` 3431 行，`Git`+`Repository` 两个 class 混在一起 | `commands/` 目录约 30 个文件：`GitHandler` 609 行 + `GitImplBase` 540 行 + `GitLineHandler`/`GitTextHandler`/`BufferingTextSplitter`/`GitHandlerAuthenticationManager`（含原生 SSH、GPG pinentry）等 | `git/cli.ts` 176 行，一个 `GitCli` class（`stream()` 移除后） |
| 命令分类 | 无系统化分类 | `GitCommand` 定义 40+ 个命令常量，每个自带 `LockingPolicy`（见 §2.3） | 无（M2 明确划出去，见 §2.3 末尾） |
| 认证 | `askpassManager.ts` + `ipc/ipcServer.ts` | `GitHandlerAuthenticationManager` + `externalApp.nativessh`/`GitAskPassAppHandler`/GPG `PinentryService`，比 vscode 更全 | `GIT_TERMINAL_PROMPT=0` 快速失败，无 askpass |
| 测试 | `git.test.ts` 720 行 | `plugins/git4idea/tests/git4idea/commands/`（`BufferingTextSplitterTest.kt` 等） | Vitest，秒级，见 CLAUDE.md D.6 |

## 1. 六模块四层结构（回顾，详见上次架构分析）

```
git4idea（backend 业务逻辑 / shared 跨端数据 / frontend UI）
  → 实现接口 + plugin.xml 声明式注册 →
vcs-api / dvcs-api（纯接口，AbstractVcs / Repository / PushSupport…）
  ← 通用骨架实现 ←
vcs-impl / dvcs-impl（跨 VCS 复用的 UI/服务：ChangesView / CommitPanel / PushDialog…）

vcs-log（独立产品线：api → graph-api → graph → impl，commit 图渲染框架）
```

依赖方向单向：`git4idea → {vcs-impl, dvcs-impl, vcs-log} → {vcs-api, dvcs-api}`。
这一层已经在上次分析里展开过，本文重点放在下面这份三方参照资料里唯一能查到"底层怎么处理
git CLI"真实细节的对象——git4idea 的 `commands/` 包。

## 1.5 层级对照：turtle_git ↔ git4idea

> 我方结构与两条流的权威版本见 `refs/vscode.md` §6。此处只做**对照**。

| turtle_git | 里程碑 | git4idea 对应物 | 备注 |
|---|---|---|---|
| `git/cli.ts` | M2 ✅ | `GitHandler` 609 行 + `GitImplBase` 540 行 + `GitTextHandler`… | 它是 ~30 个文件的包，我们是 1 个文件 176 行；差额主要在认证与平台适配 |
| `git/parsers/` | M3 ◐ | `GitLogParser` / `parseGitStatusOutput` / `BufferingTextSplitter` | 见 §2.4：它工作在已解码 `char[]`，我们在字节层 |
| `git/failure.ts` | M4 ✅ | `GitCommandResult` + `looksLikeProgress`/`looksLikeError` | **只用到了退出码语义那部分**；`looksLikeProgress`/`looksLikeError` 最终**未采用**——实测 git 在管道里默认不输出进度，见 `archive/design/M4-errors.md` §1.3 |
| `git/commands/` | M5 | `GitCommand` 40+ 常量 + `LockingPolicy` | §2.3，P0 借鉴项 |
| `core/operation.ts` | M5 | `GitImplBase.lock()`，每 Project 一把 `ReadWriteLock` | 同上 |
| `core/repository.ts` | M6 | `GitRepository`（实现 `dvcs-api` 的 `Repository`） | |
| `shared/` 领域模型 | M3 ◐ | git4idea 的 `shared` 模块 | 两边都把「跨端数据」单独成模块，独立得出同一结论 |
| `features/` | 垂直切片期 | git4idea `backend` + EP 声明式注册 | EP 反射机制不借鉴（§4） |
| `webview/` | 垂直切片期 | git4idea `frontend` + `vcs-impl` 的通用 UI | |
| **`ipc/`** | **M7** | **无对应物** | **见下** |

### `ipc/` 没有对应物——这是最重要的一条

IntelliJ 全程在同一个 JVM 里，UI 与 backend 直接调用，**不存在跨进程边界**。
我们有 `postMessage`，所以有 `ipc/protocol.ts` + `router.ts`，也才有
`CLAUDE.md §C.1` 的**第二条信任边界**。

推论有三：

1. **M7 是我们最孤立无援的里程碑。** git4idea 没有这层；vscode 的 git 扩展
   把 UI 全交给原生 SCM，也没有大型 webview（见 `refs/vscode.md` §0）。
   三份参照在 M7 上给不了任何现成答案，只有旧仓库 `shared/protocol.ts` 的
   **反面教材**（76 条声明 / 89 条注册 / 13 条漂移）。
2. **我们的数据流比它多一跳、多一次序列化。** 领域模型必须可结构化克隆
   （不能带方法、不能带 `Buffer`），这是 IntelliJ 不受的约束。
   `shared/` 里三个模型全是纯 `interface` + string enum，正好满足。
3. **控制流的取消机制不可迁移。** IntelliJ 的取消源是 IDE 全局
   `ProgressIndicator`/`ProcessCanceledException` 框架（§2.6），VSCode 生态没有对应物，
   `AbortSignal` 就是这里的答案。能照抄的只有「取消源必须能杀掉子进程」这条原则。

### 两条流的层次差异

**数据流**：同一个问题，两家切在不同层次——

```
turtle_git:  字节 ──[scan.ts 字节层切分]──► 解码 ──► 领域模型
git4idea:    字节 ──[平台库 OSProcessHandler 解码]──► char[] ──[BufferingTextSplitter 切行]──► 结构
```

§2.4 说得准确：这是「先解决字节不能被劈开，再解决行不能被劈开」的两层。
IntelliJ 把第一层交给平台库、自己做第二层（`myBufferedCr` 状态位处理跨块的 `\r\n`）；
我们两层都要自己做，M3 的 `parsers/` 补第二层。

**控制流**：闸门位置一致，驱动源不同——

```
turtle_git:  repository.run(operation) ─► operation 队列 + ReadWriteLock ─► commands ─► cli
git4idea:    （调用方）─► GitImplBase.lock() 按 LockingPolicy 取锁 ─► GitHandler
```

我们把闸门放在 `repository.run()`（跟 vscode 一致），IntelliJ 放在 `GitImplBase.lock()`。
差别是我们的闸门**同时**负责「刷不刷状态」（`readOnly` 标志），IntelliJ 的锁只管互斥。
两者都证明了同一件事：**这个闸门必须存在，不能指望调用方各自记得加锁**。

## 2. 底层对 git CLI 的处理：三方对照

### 2.1 环境变量策略

| 关注点 | turtle_git (`GitCli`) | vscode (`git.ts`) | IntelliJ (`GitHandler`/`GitImplBase`) |
| --- | --- | --- | --- |
| 密码交互 | `GIT_TERMINAL_PROMPT=0` 强制关闭，交互式认证**直接快速失败**（`cli.ts:47`） | 同样关，但额外起 `askpassManager.ts` + IPC server，`GIT_ASKPASS` 指向脚本，真正接管认证弹窗（见 `refs/vscode.md` §3.6） | 同 vscode 思路但更完整：`GitHandlerAuthenticationManager.java` 接管 `GIT_ASKPASS`/`SSH_ASKPASS`，另有 `externalApp.nativessh.NativeSshAskPassAppHandler`（原生 SSH）与 GPG `PinentryService`（提交签名） |
| optional locks | 按需由调用方通过 `ExecOptions.env` 传 `GIT_OPTIONAL_LOCKS=0`（`types.ts` 注释点名 status） | `git.ts:2745` | **不是硬编码**：`GitCommand.LockingPolicy.READ_OPTIONAL_LOCKING`（`GitCommand.java:99-107`），运行时按 `Registry.is("git.use.no.optional.locks")` + git 版本能力才加（`GitImplBase.java:205-209`） |
| 分页器 | `GIT_PAGER=cat` 冗余保险（`cli.ts:49`） | 同 | 未见强制项，stdio 走管道非 tty，依赖 git 自身 `isatty` 探测——即 turtle_git 注释里说的"零成本冗余保险"，IntelliJ 选择不加这份保险 |
| locale | `LC_ALL/LANG/LANGUAGE=en_US.UTF-8`（`cli.ts:50-53`），为 M4 错误匹配服务 | 同（`git.ts:697`） | 未见强制到 `en_US.UTF-8`；`GitExecutable.getLocaleEnv()` 按执行环境（本地/WSL）可变 |
| 路径转义 | `GIT_CONFIG_PARAMETERS: "'core.quotepath=false'"`（环境变量） | 未查 | `-c core.quotepath=false` 作为**命令行参数**永远前置，还默认加 `-c log.showSignature=false`（`GitHandler.java:162-173`） |
| 自定义变量注入点 | 无——`FORCED_ENV` 之外只有调用方传的 `options.env` | 无独立扩展点 | **有扩展点**：`VcsEnvCustomizer.EP_NAME`，允许第三方插件在跑 git 命令前改 env（`GitHandler.java:531-534`） |

三家在"强制关掉交互式密码提示"上完全一致（三次独立验证同一结论）。但在
"密码到底怎么真正拿到"上分两派——vscode 和 IntelliJ 都造了真·askpass，
**turtle_git 目前只做了前一半（关掉），没做后一半（接管）**，见 §2.2。

### 2.2 认证/密码交互——目前最大的功能缺口

`GIT_TERMINAL_PROMPT=0` 只解决"不要卡死"，没解决"怎么输密码"。turtle_git 现状下，
任何需要交互认证的 push/fetch 会直接失败（非零退出码 + stderr 类似
`could not read Username for 'https://...'`）。

vscode 和 IntelliJ 的做法一致：把 `GIT_ASKPASS`/`SSH_ASKPASS` 指向一个本地小程序，
这个小程序通过 IPC（unix socket / named pipe）把请求转给宿主进程弹 UI，
宿主回答后小程序把结果打印到 stdout 给 git 读——git 全程不知道自己在跟人还是跟 IPC 对话。

这条在 `refs/vscode.md` §3.6 已经记过（"新项目必须补的洞"），**这次在 IntelliJ
里得到独立印证**，且 IntelliJ 做得比 vscode 更全：还覆盖原生 SSH 和 GPG pinentry。
说明这层的真实需求边界比"能不能推代码"更广——只要涉及签名提交，同样的坑会再出现一次。

### 2.3 命令锁策略：`LockingPolicy`——turtle_git 完全没有的东西

`GitCommand.java:99-107` 给每个 git 子命令标注三态锁策略：

```java
public enum LockingPolicy { READ, READ_OPTIONAL_LOCKING, WRITE }

public static final GitCommand STATUS = readOptional("status");
public static final GitCommand PUSH   = read("push");   // 不改 index，但要挡 HEAD 移动
public static final GitCommand COMMIT = write("commit");
public static final GitCommand STASH  = write("stash");
public static final GitCommand CLONE  = read("clone");  // 是写，但不会跟别的命令冲突
```

`GitImplBase.lock()`（`GitImplBase.java:419-451`）据此维护一把**每个 Project 一把**的
`ReadWriteLock`：`WRITE` 命令互相排他，`READ` 命令完全不受影响，`READ_OPTIONAL_LOCKING`
命令只有在拿不到 `GIT_OPTIONAL_LOCKS=0` 能力时才需要排队。这解决的是
`.git/index.lock` 冲突——两个 git 进程同时想改 index 时，后来者会报
`Unable to create '.git/index.lock': File exists.`

turtle_git 的 `git/cli.ts` 在 M2 阶段明确把这类问题划出去（"进程层不认识
`status` 是什么"，`ExecOptions.env` 的注释），这个决定本身没错——但它目前只解决了
"单条命令怎么跑"，没有解决"多条命令之间怎么不撞车"。**IntelliJ 的方案证明这需要一个
系统化的命令分类表，而不是指望调用方各自记得加锁**。这是本次考古里 P0 级别的借鉴项，
详见 §3。

### 2.4 输出管道：字节 vs 字符，要不要留完整日志

turtle_git 的 `execRaw` 先攒 `Buffer`（`stream` 已于 2026-09-17 移除，见 M2 设计稿 §5），理由：
"逐块解码会把跨块的多字节字符劈成两半"。IntelliJ 的 `GitTextHandler`/
`BufferingTextSplitter`（`BufferingTextSplitter.java`）工作在**已解码的 `char[]`**上，
把字节安全问题交给更底层的 `OSProcessHandler`；它自己要处理的是另一个边界情况——
`\r`/`\n`/`\r\n` 换行符恰好卡在两次 `process()` 调用的边界上（`myBufferedCr` 状态位）。
两者其实是同一个问题的两层："先解决字节不能被劈开，再解决行不能被劈开"，
IntelliJ 把两层分给了平台库和自己的类，turtle_git 目前只做了第一层（M3 的 `parsers/`
应该会补第二层）。

另一处显著差异：IntelliJ 有独立的 **Git Console 工具窗口**，通过另一个
`GitLineHandlerListener`（`GitCommandOutputLogger`，`GitImplBase.java:378-417`）把每条
命令的完整输出实时回显给用户，这是给高级用户排障用的常驻功能。turtle_git 的
`makeLogOnce`（`cli.ts:79-93`）刻意**不记 stdout**（"它可能是几 MB 的 log 或文件内容"）。
两者是不同的产品决策，不是谁更对——如果以后要做类似的"Git 操作面板"，IntelliJ 这条
可以作为独立 P2 功能，不应该改动现有 logger 的"只记摘要"设计。

### 2.5 退出码语义

完全一致：`GitCommandResult` 从不因非零退出码抛异常（`GitImplBase.java:223-227`
直接把 `exitCode` 包进返回值），与 turtle_git `ExecResult`/`exec()` 的
"退出码是数据不是异常"是同一个判断（`types.ts:25` 的注释原文都可以互换）。

额外的启发式：`GitImplBase` 有 `looksLikeProgress`/`looksLikeError`
（`GitImplBase.java:464-522`）——git 把进度信息（`Receiving objects: 42%...`）
和真正的错误都写到 stderr，需要按前缀正则区分。

### 2.6 取消/超时机制

turtle_git：调用方传 `AbortSignal` → `child.kill()`。
（原 `stream()` 里还有一层 `stdout.readableEnded` 判据，用来避免把"stdout 读完但
进程还没来得及退出"误判成被杀——该方法已移除，这条经验记在 M2 设计稿 §5.4 的重建图纸里。）

IntelliJ：取消信号来自 IDE 全局的 `ProgressIndicator`/`ProcessCanceledException`
体系，本质上也是"外部信号 → kill 子进程"，但驱动源是 IDE 的进度条框架而不是
`AbortSignal`。概念一致，实现平台特定——**能照抄的只是"取消源必须能杀掉子进程"
这条原则，具体机制不可迁移**（VSCode 扩展没有类似 `ProgressIndicator` 的全局取消框架，
`AbortSignal` 已经是这个生态里的对应物）。

## 3. 值得借鉴的点（按优先级）

- **P0：命令锁分类表 + 写锁串行化**（§2.3）。这是目前 turtle_git 唯一缺失、且
  IntelliJ/vscode 都独立实现了某种形式的机制（vscode 靠 `operation.ts` 的
  `OperationManager` 做类似的事，见 `refs/vscode.md` §2）。建议在 M2 之后、
  真正开始并发跑多条写命令之前补上，否则 push+commit 之类的组合操作会偶发
  `index.lock` 报错——这是三方参照资料里唯一直接对应 IDEA 用户真实遇到过的坑的条目。
- **P0（长线）：真·askpass**（§2.2）。当前"关掉终端提示直接失败"对用户来说是
  "莫名其妙失败"，只要涉及 HTTPS/SSH 认证或 GPG 签名提交就会撞上。
- **P1：stderr 的 `looksLikeProgress`/`looksLikeError` 启发式**，作为 M4
  `errors.ts` 设计的输入。
- **P2：可选的完整命令输出回显面板**（对照 §2.4 的 Git Console），需求优先级
  明显低于 P0/P1，且不应该改动现有 `logger` 的"只记摘要"策略。
- **已相互印证、不用改的**：退出码是数据不是异常 / `core.quotepath=false` /
  强制关闭终端密码交互 / 字节优先于文本的解码顺序——三份参照资料一致同意，
  进一步确认 turtle_git 现有 M2 设计方向是对的，不需要因为这次考古而返工。

## 4. 明确不借鉴 / 不适用

- **EP（扩展点）反射注册机制**——Java 插件体系特有，VSCode 扩展没有对应物，
  `features/` 目录的"自注册 handler"已经覆盖同等需求（见 `refs/vscode.md` §6）。
- **`TrustedProjects` 工作区信任检查**——VSCode 自己有 workspace trust API，不需要重造。
- **Windows `cmd.exe` caret 转义**（`GitHandler.escapeParameterIfNeeded`，仅当可执行文件
  是 `.cmd` 时触发）——turtle_git `spawn` 不走 shell，正常情况用不上；但如果未来遇到
  某些 Windows 包管理器（Scoop/Chocolatey）用 `.cmd` shim 包装 git，这是要重新踩的坑，
  先记一笔。
- **`Registry`/`AdvancedSettings` 运行时功能开关体系**——量级远超 turtle_git 需求，
  VSCode 的 `workspace.getConfiguration()` 已经够用。

## 5. 交叉验证（三份参照资料同时得出的结论，可信度最高）

- `GIT_TERMINAL_PROMPT=0`：vscode + IntelliJ（间接，通过接管 askpass 达到同等效果）
  + turtle_git 自己的 M2 决策，三方一致。
- `core.quotepath=false`：vscode 用环境变量 `GIT_CONFIG_PARAMETERS`，IntelliJ 用
  `-c core.quotepath=false` 命令行参数，殊途同归。
- 退出码是数据不是异常：三方一致，且 `GitCommand.STATUS`/`PUSH`/`CLONE` 的分类
  注释里能看到 JetBrains 工程师对"这个命令到底算不算写"反复斟酌的痕迹
  （例如 `PUSH` 被标成 `READ`，理由是"不改本地 index，但仍要挡住 COMMIT 移动 HEAD"）——
  说明这类边界判断本来就没有标准答案，重要的是**显式写下判断依据**，而不是隐含约定。

## 7. 提交图（`platform/vcs-log`，第 8 阶段用）

> 路径前缀：`graph/` = `platform/vcs-log/graph/src/com/intellij/vcs/log/graph/`，`impl/` = `platform/vcs-log/impl/src/com/intellij/vcs/log/`。

### 7.1 没有独立的 Graph 列，图画在 Message 单元格里

- `GraphCommitCellRenderer.customize`（`impl/ui/render/GraphCommitCellRenderer.kt:206-246`）：每行先算本行的 `graphWidth`，再 `appendTextPadding(graphWidth)` 把文字往右推，然后在同一个单元格里画图。
- **每行的宽度各自算**（`impl/ui/render/GraphCommitCellUtil.kt`）：
  ```
  本行宽度 = max(本行最右元素的位置 + 1, min(6, recommendedWidth)) × 16px + 2px
  ```
  - 「本行最右元素」包括节点和穿过本行的线；斜线按两端位置的**平均值**算（斜线在本行只画了一半）。
  - `MAX_GRAPH_WIDTH = 6`；`recommendedWidth`（`graph/impl/print/PrintElementGeneratorImpl.kt:53-124`）是前两万行宽度的**加权平均 + 一个标准差**，靠上的行权重大（最上一行权重是最下一行的 10 倍）。
  - 效果：有一个公共的「基准宽度」= min(6, 典型宽度)；比基准窄的行文字对齐到基准，比基准宽的行文字单独往右退。截图里底部几行对齐、顶部几行各自退让，就是这样来的。
- 常量（`impl/paint/PaintParameters.java`）：行高 22，车道宽 16，节点半径 4（直径 8），线宽 1.5（选中时 2.5），图与文字间隔 2。

### 7.2 车道：全局 layoutIndex + 每行按序排位（天然压缩）

- `GraphLayoutBuilder`（`graph/impl/permanent/GraphLayoutBuilder.kt`）：把所有「头」（没有子提交的提交，加上分支指向的提交）排序，从每个头出发做 DFS，**优先走还没编号的父提交**（第一父提交在前），沿途提交拿同一个 `layoutIndex`；走到底换下一个编号。一条分支的第一父链因此共享一个编号。
- 头的排序（`git4idea/backend/src/log/GitRefManager.kt` 的 `GitBranchLayoutComparator`）：`origin/master|main` → 其它远程分支 → `master|main` → 本地分支 → tag → HEAD（detached 时才单独是头）；同类按名字排。主干排最左。
  表里虽列了 `CURRENT_BRANCH`，但只有标签用的 `GitLabelComparator` 会产出它，布局里当前分支不特殊对待。
- **一行里的「位置」不是固定车道**：`PrintElementGeneratorImpl.getSortedVisibleElementsInRow` 把本行的节点和穿过的线按 `layoutIndex` 排序（`GraphElementComparatorByLayoutIndex`），位置就是排序后的序号 0、1、2…。左边有线结束时，右边的线下一行自动左移一格，于是出现斜线。**车道永远是压缩的**，没有空列。
- 所以布局只在整张图上算一次（编号），每行的位置是按需派生的（带 100 行的 LRU 缓存）。

### 7.3 线的画法

- `SimpleGraphCellPainter.paintEdge`：每段线从本行节点中心画到**相邻行**目标位置的中心，超出本行的部分被单元格裁掉；上下两行各画一半，拼起来就是一条跨一行的斜线。竖线直接画到行边。全是直线，没有曲线。
- 节点：普通是实心圆；HEAD 所在提交是「外圈 + 实心」（`impl/ui/table/HeadPrintElements.kt`，`GraphTableModel.kt:105-111`）。
- 选中提交时，与它相连的线和节点先用黑色粗线描一遍，再用原色细线画一遍（突出显示）。

### 7.4 长线（默认隐藏中间）

- `PrintElementGeneratorImpl`：跨度 ≥ 30 行的线（`LONG_EDGE_SIZE`），只在两头各露 1 行（`LONG_EDGE_PART_SIZE`），带箭头，中间不画、不占位置。默认就是隐藏（`VisibleGraphImpl.isShowLongEdges = false`）。
- 打开「显示长线」后：跨度 ≥ 1000 行才隐藏、两头各露 250 行；≥ 30 行的线在离端点 1 行处画箭头。
- 截图里的 `∨` 就是这个。IDEA 的图能保持窄，主要靠它；`recommendedWidth` 的统计也把被隐藏的线算成箭头。

### 7.5 颜色

- `GraphColorGetterByHead` + `GraphColorManagerImpl`：一个提交的颜色由它所在的 `layoutIndex` 决定。如果这个编号就是某个头的主链，颜色 = 头上**第一个 ref 名字的 hash**（同一个分支名在任何仓库、任何时候都是同一个颜色）；否则（分叉出来的片段）颜色 = 编号本身。
- 线的颜色取两端里 `layoutIndex` 较大的那个节点的颜色。
- 颜色值（`impl/graph/DefaultColorGenerator.kt`）：由颜色 id 算出色相，饱和度 0.4、亮度 0.65 固定，所以颜色无限多但都偏柔和。

### 7.6 筛选时的虚线

- `graph/collapsing/DottedFilterEdgesGenerator.kt`：在**完整的图**上隐藏不匹配的节点，两趟线性扫描（从上往下、从下往上），每个节点记住「沿被隐藏的路径能到达的最近可见节点」，可见节点与之连一条虚线（`DOTTED`）。超出处理范围的画成虚线箭头（`DOTTED_ARROW_UP/DOWN`）。复杂度是线性的，不是逐个 BFS。
- 筛选后的图沿用完整图的 `layoutIndex`，所以车道顺序与不筛选时一致，只是被隐藏的行不占位置。
- 虚线的虚线段长度按线长调整，保证整数个段（`SimpleGraphCellPainter.getDashLength`）。

### 7.7 ref 标签

- 默认**靠右**（`VcsLogApplicationSettings.isLabelsLeftAligned = false`）：画在 Message 单元格的最右边，起点 = max(本行图宽, 单元格宽 − 标签总宽)；可以在设置里改成紧跟在图后面。
- 标签可用宽度（`getAvailableWidth`）：非紧凑模式下，至少能占「文字区的一半」或「文字区 − 80px」，取较大者，即说明文字至少保留 80px。
- 标签名放不下且超过 22 个字符时截断（`LabelPainter.shortenRefName`）：先把第一个 `/` 之前的部分换成 `..`（`../yuancai_add…`），再在末尾加省略号。
- 分组（`GitRefManager.groupForTable`）：当前分支单独一组排第一；**本地分支和它跟踪的远程分支合并成一个标签**；其余按类型分组；HEAD 并进第一组。
- 标签顺序（`GitLabelComparator`）：HEAD → 当前分支 → master/main → origin/master|main → 本地分支 → 远程分支 → tag。

### 7.8 两处高亮（不在第 8 阶段需求里）

- `MergeCommitsHighlighter`：合并提交的文字变灰。
- `VcsLogCommitsHighlighter`：当前用户的提交，作者名加粗（仓库只有一个作者、或正按 Me 过滤时不加粗）。
- `CurrentBranchHighlighter`：当前分支包含的提交加一层浅色背景（按单个别的分支过滤时才开）。
- 我们的需求池里有「合并提交 / 当前分支提交高亮」。

## 9. 改写历史（第 9 阶段用）

路径前缀：`G` = `plugins/git4idea/backend/src`，`B` = `GitBundle.properties`。

### 9.1 Log 右键菜单（`Git.Log.ContextMenu`，`intellij.vcs.git.backend.xml:390-413`）

顺序：Reset Current Branch to Here… / Revert Commit / Undo Commit… / ——— / Edit Commit Message… / Fixup… / Squash Into… / Drop Commits / Squash Commits… / Interactively Rebase from Here… / Push All up to Here… / ——— / 分支操作、新建分支、新建 tag。

### 9.2 Reset（`G/reset/GitNewResetDialog.kt`、`GitResetAction.java`）

- 对话框四选一：Soft / Mixed / Hard / Keep，默认 Mixed，记住上次的选择。对话框本身就是确认，Hard 不再另问。
- 说明文字（`B:1193-1202`）：Soft「Files won't change, differences will be staged for commit.」；Mixed「…won't be staged.」；Hard「Files will be reverted to the state of the selected commit. Warning: any local changes will be lost.」；Keep「…but local changes will be kept intact.」
- 不预先 stash；git 报「会覆盖本地改动」时才问 Smart（stash/shelve 后 reset 再恢复）或 Hard。
- 不做「提交在不在当前分支」「是否已推送」检查，任意提交都能选。

### 9.3 Undo Commit（`G/reset/GitUncommitAction.java`）

- 只能单选、必须是 HEAD、不能是 merge 提交、不能已推送到受保护分支。
- `reset --soft <第一个父提交>`；改动进选定的 changelist；**原说明填回提交框**。
- **没有**一次撤销多条的动作。

### 9.4 Reword / Squash / Fixup / Drop 的共同检查（`G/rebase/log/GitCommitEditingActionBase.kt`）

- 不能跨仓库；merge 提交（父提交 > 1）不行：「Selected commit has {0} parents」。
- 必须在 HEAD 的线性历史上（从 HEAD 深搜到最早选中的提交，途中不能有 merge）：「The commit is not in the current branch」。
- **已推送的判定只看受保护分支**（默认 `master`、`main`，`GitSharedSettings.java:35`）：「The commit is already pushed to protected branch '{0}'」——直接禁用，不给「仍然继续」。推到别的远程分支（包括自己的 upstream）**不提示**。
- Reword 与交互式 rebase 在 rebase/merge/cherry-pick/revert 进行中禁用；Drop、Squash 不禁。
- 选中根提交时确认「Are you sure you want to edit the initial commit?」。

### 9.5 各动作

- **Reword**「Edit Commit Message…」：单选。非模态对话框，多行说明编辑器，空说明不能确认。HEAD 时走 `commit --amend --only`；否则 todo 里 `pick`→`reword`。
- **Squash Commits…**：多选（可不连续：把其余选中的挪到最早那条后面，夹在中间的未选提交被排到后面）。合并说明 = 各条去重拼接（同时去掉目标也在选中范围里的 `fixup!/squash!` 前缀行），对话框里可改。
- **Fixup… / Squash Into…**：不是「把一条已有提交并进另一条」，而是**把当前未提交的改动**提交成 `fixup! <subject>` / `squash! <subject>`，可选「Commit and Rebase…」接着 `rebase -i`。
- **Drop Commits**：多选；确认「Do you want to drop {0} commit(s) from the <b>{1}</b> branch?」，可勾「不再询问」。
- 成功通知都带 **Undo**（`reset --keep <旧 HEAD>`；HEAD 已动或已推到受保护分支时拒绝）。

### 9.6 实现

- 默认先在内存里造提交（`inMemory/`），Reword 不碰工作区；Squash/Drop 树变了才 `reset --keep`，期间自动保存本地改动。遇冲突**整个丢弃，退回 `git rebase -i`**。
- 普通 rebase 前保存本地改动（默认 **shelve**，可选 stash），只在成功或没开始时恢复；冲突停下时改动留在 stash/shelf 里，通知里注明。
- 停下后与普通 rebase 共用继续/放弃。

### 9.7 Force Push（`platform/dvcs-impl/.../push/ui/ForcePushAction.kt`、`G/push/`）

- 只在 Push 对话框里（Push 按钮的下拉）。没有「改写完提示去 force push」。
- 确认「You're going to force push to <b>{0}</b>. It may overwrite commits at the remote. Are you sure you want to proceed?」，可勾「Don't warn about this target」。
- 受保护分支（默认 master/main）禁止 force push。
- 默认 `--force-with-lease=<远程分支>:<本地记录的远程 hash>`；lease 被拒时通知带「Force push anyway」（改用 `--force`）。无 `--force-if-includes`。

## 8. 待补充

- [ ] `GitExecutableManager`（git 可执行文件探测、WSL 支持）与 turtle_git 未来
      "`vscode/` 层探测 `gitPath`"设计的对照——本次未展开。
- [ ] IntelliJ 的 `GIT_TRACE*` 环境变量诊断开关（`GitImplBase.java:252-271`），
      是否值得给 turtle_git 加一个"诊断模式"。
