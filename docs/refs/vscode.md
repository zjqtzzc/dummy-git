# 架构考古笔记（来源：vscode/extensions/git @ 1.134.0）

> 目的：抽取可复用的抽象，并**明确标出哪些不适用**。
> 对照物：`jetbrains-git-graph`（见 refs/old-repo.md §1 的债务清单）。

## 0. 规模对比

| | vscode/extensions/git | jetbrains-git-graph |
| --- | --- | --- |
| 扩展侧 TS | 25,130 行 | ~7,300 行（src/ + shared/） |
| webview | **无** | ~14,600 行（5 个 React app） |
| 测试 | 有（git.test.ts 720 行、smoke、askpass、cache） | 4 个文件，仅 webview 工具函数 |
| 最大文件 | `commands.ts` 5780 / `repository.ts` 3549 / `git.ts` 3431 | `extension.ts` 1720 |

**关键结构差异：vscode 的 git 扩展没有大型 webview。** 它把 UI 全部交给 VSCode 原生
SCM 视图，自己只做 provider。所以它的架构经验**只覆盖扩展主机侧**——
webview 状态同步、图形渲染、虚拟列表这些我们最难的部分，在这里找不到答案。

⚠️ 本地 `~/Projects/vscode` 是**部分检出**：只有 `extensions/`，没有 `src/vs`。
⚠️ **该目录已不在本机**（2026-09-21 发现）。参照源码现在在 `.notes/git/`；
但**基于它测出的所有性能数字都无法复现**，恢复办法见 `tech/performance.md` §0。
VSCode 自己的 SCM Graph 渲染实现（`src/vs/workbench/contrib/scm/`）**不在本地**，
如需参考要另行完整 clone。

## 1. 三层分离（最该照抄的结构）

```
Git (git.ts)                进程层：拼命令、spawn、编码、解析、错误码
  └─ Repository (git.ts)    单仓库的"git 命令集"，仍然不认识 vscode API
       └─ Repository (repository.ts)  状态机：资源分组、操作队列、事件、UI 绑定
            └─ Model (model.ts)       多仓库：发现、打开/关闭、生命周期、workspace 事件
```

注意 `git.ts` 里有两个 class：`Git`（进程工厂）和 `Repository`（命令集合，1357 行往下）。
`repository.ts` 的 `Repository` 是**另一个**类，包着前者做状态管理。这个双 Repository
命名很糟，我们照抄结构但换名字（建议 `GitCli` / `GitRepo` / `RepositoryState` / `Workspace`）。

**jetbrains-git-graph 缺的正是中间那层。** 它有 `gitService`（≈ `git.ts`）和
`views/*Provider`（≈ UI），中间没有状态机，导致所有状态协调逻辑散在
`extension.ts` 的 91 个 handler 里。

## 2. 操作队列（`operation.ts`，290 行，**直接照抄**）

每个 git 操作被建模为一个带元数据的值：

```ts
type BaseOperation = {
  kind: OperationKind;     // 68 种：Add/Commit/Fetch/Rebase/Stash/...
  blocking: boolean;       // 运行时禁用命令
  readOnly: boolean;       // 只读操作不触发状态刷新
  remote: boolean;         // 涉及网络
  retry: boolean;          // 可重试（锁冲突时）
  showProgress: boolean;   // 是否显示进度
};
```

`OperationManager` 维护 `Map<OperationKind, Set<Operation>>`，派生出四个全局问题的答案：
`isIdle()` / `isRunning(kind)` / `shouldDisableCommands()` / `shouldShowProgress()`。

核心执行包装 `Repository.run()`：

```ts
this._operations.start(op); this._onRunOperation.fire(op.kind);
try {
  const result = await this.retryRun(op, runOperation);
  if (!op.readOnly) await this.updateModelState(optimisticGroups);  // 写操作后统一刷状态
  return result;
} catch (err) {
  if (err is NotAGitRepository) this.state = Disposed;
  if (!op.readOnly) await this.updateModelState();                  // 失败也要刷
  throw err;
} finally {
  this._operations.end(op); this._onDidRunOperation.fire({op, error});
}
```

**为什么这对我们是关键**：
- "点快了状态错乱"、"进度条该不该转"、"按钮该不该禁用"三类问题一次性解决；
- `readOnly` 标志天然解决了 tech/traps.md §1 里
  "status 回写 index → 触发刷新 → 又跑 status" 的回路；
- `retry` + 锁冲突 = 旧仓库 `d53cda9` 那条 fix 的正解；
- **失败路径也刷状态**，旧仓库多条"操作失败后面板不刷新"的 fix 本质都是这个。

## 3. 值得抄的小抽象

### 3.1 `decorators.ts`（90 行，**直接抄**）
`@memoize` `@throttle` `@sequentialize` `@debounce(ms)`，纯方法装饰器，无依赖。

- `@throttle`：运行中再调用 → 合并成"当前这次结束后再跑一次"，多次调用只排一个 next。
  这正是刷新按钮连点的正确语义。
- `@sequentialize`：串成链，用于 `openRepository` 这类不能并发的。
- 旧仓库的 `utils/debouncedSet.ts` 是这套东西的局部手写版。

### 3.2 事件即 API
`Repository` 暴露 7 个 EventEmitter：`onDidChangeRepository` / `onDidChangeState` /
`onDidChangeStatus` / `onDidChangeOriginalResource` / `onRunOperation` /
`onDidRunOperation` / `onDidChangeBranchProtection`。
所有 UI 侧（statusbar / decorations / actionButton / historyProvider）只订阅事件，
不反向调用 Repository。

→ 我们的 webview 广播（`refsChanged` 等 4 个域事件）就是这套的对应物，
概念正确，但当前是 `MessageRouter` 全局广播，没有挂在 Repository 上。多仓库时会出问题。

### 3.3 `@memoize get` 做懒计算属性
`Resource` 类用 `@memoize` 缓存 `resourceUri` / `command` / `decorations`，
列表行的派生数据零成本重复读取。我们的提交行有同样需求。

### 3.4 进程层细节（血泪，抄）
- `GIT_OPTIONAL_LOCKS: '0'`（`git.ts:2745`）——**与旧仓库 `ed3a30d` 独立得出同一结论，双重验证**
- `byline.LineStream` 流式读取 `utf8`，而不是等 buffer 全量
- `detectUnicodeEncoding` 处理 UTF-16 文件
- `onSpawn` 钩子暴露 child process（用于取消 / askpass）
- `commandsToLog` 配置化的命令日志

### 3.5 解析器全部是纯函数并导出
`parseGitCommits` / `parseGitRemotes` / `parseGitmodules` / `parseLsTree` /
`parseLsFiles` / `parseCoAuthors` / `GitStatusParser` / `GitConfigParser`
→ 因此 `git.test.ts` 能有 720 行纯单测。
**旧仓库的 `parsers.ts` 已经是这个形态了，只是没测试。** 这是最低成本的质量提升点。

### 3.6 `askpassManager.ts` + `ipc/ipcServer.ts`
凭据交互：起一个 IPC server，把 `GIT_ASKPASS` 指向一个小脚本，脚本通过 IPC 回问扩展。
**旧仓库完全没有这层**——所以任何需要输密码的 push/fetch 大概率是静默失败或卡住。
这是新项目必须补的洞。

### 3.7 `cache.ts` / `repositoryCache.ts`
提交与仓库元数据的缓存层，含失效策略。旧仓库的 `src/git/cache.ts` 需要对照审视。

## 4. VSCode 集成点清单（我们要选择性使用）

| 文件 | 集成点 | 我们是否需要 |
| --- | --- | --- |
| `fileSystemProvider.ts` | 自定义 scheme 读任意 revision | **需要**（旧仓库已有 `gitContentProvider`） |
| `quickDiffProvider.ts` | 编辑器边栏改动标记 | 可选（VSCode 内置 git 已提供，会重复） |
| `decorationProvider.ts` | 资源管理器文件着色 | 同上，会与内置冲突，需决策 |
| `historyProvider.ts` (613行) | `SourceControlHistoryProvider` —— **VSCode 原生 SCM Graph 的数据契约** | **重大决策点，见 §5** |
| `timelineProvider.ts` | 文件时间线 | 可选，低成本高价值 |
| `blame.ts` (755行) | 行内 blame | 旧仓库无，IDEA 有（Annotate），值得补 |
| `statusbar.ts` / `actionButton.ts` | 状态栏 / SCM 主按钮 | 需要 |
| `api/git.d.ts` (514行) | 对外扩展 API | 后期考虑 |
| `protocolHandler.ts` / `cloneManager.ts` | clone / URI handler | 不需要 |
| `postCommitCommands.ts` | 提交后动作（commit&push 等） | **需要**，旧仓库自己手搓了 |
| `diagnostics.ts` | 环境自检 | 值得有 |

## 5. 三个必须现在就定的架构决策

### 决策 A：webview 自绘 vs 复用 VSCode 原生 SCM
VSCode 1.134 已经原生提供 SCM History/Graph 视图，扩展只需实现
`SourceControlHistoryProvider`（`historyProvider.ts` 613 行就是全部成本）。

- **走原生**：成本极低，自动获得虚拟滚动、主题、无障碍、hover。
  但**拿不到 IDEA 的三栏布局和交互密度**——而那正是这个项目存在的理由。
- **自绘 webview**：保留 IDEA 体验，代价是 tech/traps.md §3 那 60 条 UI fix 要重走。

**建议：自绘为主，但同时实现 `historyProvider`**。后者几乎白送，能让不打开面板的用户
也受益，且是 VSCode 官方演进方向。

### 决策 B：协议如何防漂移
旧仓库 13 条命令游离于协议之外。方案：把 `CommandType` 从字符串联合改成
**"命令名 → 参数类型 → 返回类型" 的映射接口**，注册器签名为
`handle<K extends keyof Commands>(k: K, h: (p: Commands[K]['params']) => Promise<Commands[K]['result']>)`，
再加一条 `Record<keyof Commands, true>` 的完备性断言。漏注册编译不过，多注册也编译不过。
webview 侧 `request()` 同样泛型化，参数/返回自动收窄。

### 决策 C：多仓库
vscode 的 `Model` 处理了：workspace folder 扫描（带深度与忽略目录）、
submodule、worktree、parent repository、unsafe repository（dubious ownership）、
closed repository、virtual filesystem。这是 1225 行里的大部分。

旧仓库只有"聚合所有 workspace folder 的改动"（`f635c78`）这一条 fix，其余基本假设单仓库。

**已定（2026-09-18）：第一版只支持单仓库。** 细则见 `tech/decisions.md`，要点：

1. **检测用 `git rev-parse --show-toplevel`，不是找 `./.git`**——后者有两个实测的坑：
   `.git` 在 worktree/submodule 里是**文件**不是目录（42 字节，内容 `gitdir: …`）；
   用户打开仓库子目录时 `./.git` 根本不存在。vscode 同此做法（`git.ts:505`）。
   附带收益：git 返回的规范化根路径**就是**我们的仓库标识，不必自定义规则。
2. **激活时一次确定，之后不变**，不跟随活动编辑器——仓库会变就意味着所有状态要重新归属，
   那是多仓库的全部复杂度却拿不到多仓库的好处。多 workspace folder 时取第一个，
   并给出明确消息，不静默。
3. **签名按多仓库写，实现按单仓库做**：命令函数第一个参数是 `repo`，
   `Repository` 可实例化多份，锁是其实例字段，协议与广播都带仓库标识。
   不在 module scope 放全局状态——升级路径一直开着。
4. **`core/workspace.ts` 本阶段不存在**（原架构图里有，已删）——单仓库下它没有职责，
   留着就是「图上有、验收标准里没有」。

## 6. 目标架构（2026-09-17 校准，2026-09-20 随 M6 完成再校准，与实际代码一致）

> 原草图写于考古阶段，已按实际落地形态重写：monorepo 三包、领域模型进 `shared/`、
> `GIT_OPTIONAL_LOCKS` 归命令层。
> ~~不写单测~~ ——该决策已到期（`process/testing.md`），现在写，M2–M6 全部补齐，159 条。

```
packages/
  shared/          中立层：extension 与 webview 双向引用，自己不依赖任何人
    ref.ts         Ref / Upstream                    ← M3 ✅
    change.ts      FileChange / FileStatus / ConflictKind  ← M3 ✅
    commit.ts      Commit / Signature                ← M3 ✅
    error.ts       GitErrorCode（2 个码）             ← M4 ✅
    assertNever.ts 穷尽性检查                          ← M1 ✅

  extension/src/
    git/           禁 import vscode（lint 强制）
      cli.ts         spawn / 编码 / 日志 / 取消        ← M2 ✅
      types.ts       ExecOptions / ExecResult / GitLogger ← M2 ✅
      parsers/       纯函数，吃 Buffer 吐领域模型      ← M3 ✅
        scan.ts        字节层切分（Range + decode）
        log.ts         Commit
        refs.ts        Ref / Upstream
        status.ts      FileChange（porcelain v2）
        errors.ts      **解析失败**的诊断（不是 git 错误）
        index.ts       出口
      failure.ts     classifyError / run / GitFailureError ← M4 ✅
                     （**命令失败**分类，区别于 parsers/errors.ts 的解析失败）
      commands/      按域切，每条命令带锁策略与 env    ← M5 ✅
        checkIgnore.ts   批量 `check-ignore`，服务 ignoreCache ← M6 ✅
    core/
      operation.ts   写命令互斥排队（两态锁）          ← M5 ✅
      executor.ts    锁策略 + 执行体绑死，配错在结构上不可能 ← M5 ✅
      domains.ts     refs / worktree / stash / operation（纯枚举，零数据表）← M6 ✅
      classify.ts    .git 内路径 → 域（纯函数）        ← M6 ✅
      ignoreCache.ts 工作区路径是否该忽略（向 git 问，不自己实现匹配）← M6 ✅
      debounce.ts    DebouncedSet（150ms / maxWait 1000ms）← M6 ✅
      watchPatterns.ts  订阅用的 glob 白名单           ← M6 ✅
      repository.ts  状态机：私有持有 cli/队列/watcher，run() + onDidChange + state ← M6 ✅
                     （无 workspace.ts：第一版单仓库，见决策 C；
                      只读节流未做——按 D.5.1(a) 答不出消费者是谁）
    ipc/
      protocol.ts    泛型映射式协议（漏注册编译不过）   ← M7
      router.ts      类型安全注册 + 广播（**事件带仓库标识**）← M7
    vscode/          gitPath 探测 / OutputChannel      ← M7（最小部分）
                     选定唯一仓库（workspace folder → rev-parse）← M7
                     FileSystemProvider / statusbar…   ← 垂直切片期
    features/        一个功能一个目录，自注册 handler   ← 垂直切片期
      log/ commit/ push/ rollback/ conflicts/ shelf/

  webview/         React UI                          ← 垂直切片期
```

**无主待办**（见 `PLAN.md`）：askpass 层三件套 → M7 之后第一个独立任务。

### 6.1 两条信任边界正好夹住整个系统

`CLAUDE.md §C.1` 规定运行时校验**只在两个边界**。画出来才看清这句话的分量：
这两个边界就是上面那张图的**最上端与最下端**。

```
git stdout (Buffer) ──[边界①: parser 校验]──► 信任区 ──[边界②: router 校验]──► webview
```

外面是 git 的字节流与 webview 的 postMessage，两者都可能是任何东西；
里面（parsers / errors / commands / core / features）类型说什么就是什么。
C.2「边界之内不写防御性检查」不是偷懒——验证已经在入口做过一次。

### 6.2 数据流（向上，读路径）

```
git 子进程
   │ stdout: Buffer                          ← 字节，未解码
   ▼
cli.execRaw()                                            M2 ✅
   │ RawExecResult { exitCode, stdout: Buffer, stderr }
   │ ↑ 退出码是数据，不抛
   ▼
parsers/   scan.split() → Range[]                        M3
   │       scan.decode(buf, range) → string
   │       ↑ 在字节层切，切完才解码
   │       wire → enum 映射表（'M' → FileStatus.Modified）
   ▼
shared/    Commit / Ref / FileChange                     M3
   │ 我们自己的领域模型，已无 git 原始字符
   ▼
core/repository   域状态（refs / worktree / stash）       M6
   │ onDidChangeX 事件
   ▼
ipc/router  广播 → postMessage                           M7
   ▼
webview store → React 组件                          垂直切片期
```

每层**只加一个概念**：字节 → 结构 → 语义 → 状态 → 界面。

其中 `scan.ts` 在**字节层**切分而非解码后 `split()`，是这条链上最关键的一环：
V8 的 `split()` 返回 sliced string，会拖住整个原串不释放（实测 40MB 输入、
只保留 12.6KB 字段，整体解码后 split 占 25MB，按字节逐字段解码占 0MB）；
且按字节找分隔符切不坏多字节字符——UTF-8 多字节序列每个字节都 ≥ 0x80，
而分隔符 `\0` `\x01` `\n` 全都 < 0x80。它交出 `Range`（两个数字）而非
`subarray`（共享内存），把「漏出去就拖住缓冲区」在结构上堵死。

### 6.3 控制流（向下，写路径）

```
webview 交互（点 Commit 按钮）
   │ request(type, params)
   ▼
ipc/router   查表 → handler                              M7
   ▼
features/commit   业务编排                          垂直切片期
   ▼
core/repository.run(operation)                           M6
   │ ┌── operation 元数据：blocking / readOnly / remote / retry
   │ │   core/operation.ts 队列 + 每仓库一把 ReadWriteLock   M5
   │ ▼
   │ 【唯一闸门】所有写操作在此串行化
   ▼
git/commands/   按域切的命令包装                          M5
   │ 知道「status 要带 GIT_OPTIONAL_LOCKS=0」
   │ 知道「读 stdin 的命令 input 参数必填」
   │ 知道「本命令是 READ / READ_OPTIONAL / WRITE」
   ▼
cli.exec / execRaw                                       M2 ✅
   ▼
git 子进程
   │
   └─► 完成后：非 readOnly 操作触发状态刷新 ──► 转入 §6.2 数据流向上广播
```

### 6.4 两条流刻意不对称

- **控制流向下走窄口**：所有写操作必须过 `repository.run()` 这一个闸门。
  只有这样才能回答「现在能不能点这个按钮」「进度条该不该转」
  「两个 git 进程会不会抢 `.git/index.lock`」。
- **数据流向上走宽口**：事件广播，谁想听谁订阅。UI 侧只订阅，
  **从不反向调用 `Repository`**（vscode 的 7 个 EventEmitter 就是这个形态，见 §3.2）。

闭环在最后一步：写操作完成 → 刷新状态 → 走数据流广播上去。
**失败路径也必须刷新**——旧仓库多条「操作失败后面板不刷新」的 fix，
根因都是只在成功分支刷了状态（见 §2 对 `Repository.run()` 的分析）。


关键约束：
- `git/` 不 import `vscode`（lint 强制，M1 验过）——换个宿主也能用
- `features/` 不直接调 `git/`，只经 `core/repository`（lint 强制）
- 领域模型放 `shared/` 而非 `git/`：webview 最终要渲染它们
- 每个 feature 自注册 handler，`extension.ts` 只做装配（目标 < 150 行）
- 运行时校验只在两个边界：`git stdout → parser`、`postMessage → router`，
  两者正好是这条链的两端，之间一律信任类型

## 7. 待补充的考古

参照资料现已全部本地化（`.notes/` 内，均为一次性下载物、无 git 历史）：
`.notes/git/`（vscode extensions/git @1.134.0）、`.notes/rebased-master`（IntelliJ 裁剪源码）、
`.notes/vscode-gitlens-main`（GitLens，已清理至 20M，见 `refs/gitlens.md`）、
`~/Projects/jetbrains-git-graph`（只读）。

- [ ] `commands.ts` 5780 行的组织方式（我们的 `features/` 分法是否对得上）
- [ ] `cache.ts` / `repositoryCache.ts` 的失效策略
- [ ] `blame.ts` 实现（若决定做 Annotate）
- [ ] VSCode SCM Graph 渲染实现 —— 仍缺：`.notes/git/` 只是 git 扩展，
      渲染在 vscode core 的 `src/vs/workbench/contrib/scm/`，未下载。
      **但优先级已降**：决策 A 已定自绘为主、`historyProvider` 降 P2
- [ ] `GitExecutableManager`（git 探测 / WSL）—— 对照 `vscode/` 层的 gitPath 探测，M7 用
- [ ] IntelliJ `GIT_TRACE*` 诊断开关（`GitImplBase.java:252-271`）—— 是否加「诊断模式」，P2
- [ ] Windows：git 被 `.cmd` shim 包装时的 caret 转义（Scoop/Chocolatey）——
      我们 `spawn` 不走 shell，正常用不上；踩到再说，先记一笔
