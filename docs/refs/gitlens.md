# 架构考古笔记（来源：GitLens）

> 来源：`.notes/vscode-gitlens-main`，一次性下载物，无 git 历史，file:line 只在当前快照有效。
> **已清理**：84 M → 20 M，删掉 images / l10n / 付费与 AI 功能 / 测试 / 文档 / 非相关 feature，
> 保留 `packages/`（含 `plus/commit-graph*`）、`src/{git,webviews,views,commands,system}` 与装配层。
>
> **为什么这份最值得看**：四个参照里，只有 GitLens 和我们处境相同——
> **自己拥有 webview 界面的 VSCode 扩展**。vscode 的 git 扩展把 UI 交给平台，
> IntelliJ 不是 VSCode 扩展，旧仓库是我们要替换掉的那个。

---

## 1. 模块与分层图

```
┌─────────────────────────────────────────────────────────────────────┐
│  src/  —— VSCode 扩展（唯一 import vscode 的地方）                    │
│                                                                      │
│   webviews/            views/         commands/      statusbar 等     │
│   ├ rpc/  (Supertalk)  树视图          命令注册                        │
│   ├ webviewController                                                │
│   └ apps/ (前端)                                                     │
│            ▲                                                         │
│   ┌────────┴─────────────────────────────────────────┐              │
│   │ src/git/  —— 适配层                               │              │
│   │   gitProviderService.ts (2573)  跨 provider 路由   │              │
│   │   gitRepositoryService.ts (556)                   │              │
│   │   gitUri / fsProvider / graphRowProcessor          │              │
│   └────────┬─────────────────────────────────────────┘              │
│   container.ts (971)  服务定位器，装配一切                            │
└────────────┼─────────────────────────────────────────────────────────┘
             │ 注入 FileSystemProvider / WorkspaceProvider / FileWatcher 工厂
             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  packages/  —— 六个包，**零个 import vscode**（已验证）                │
│                                                                      │
│  ┌─────────────────────────┐   ┌──────────────────────────────────┐ │
│  │ @gitlens/git  (32k 行)   │   │ @gitlens/plus/commit-graph (10k) │ │
│  │  context.ts   宿主契约    │   │   布局 / 几何 / 分页 / 投影 / 时间 │ │
│  │  providers/   22 个接口   │   │ commit-graph-ui (21k)            │ │
│  │  models/      领域模型    │   │   渲染                            │ │
│  │  parsers/     解析        │   └──────────────────────────────────┘ │
│  │  watching/    监听子系统  │   ┌──────────────────────────────────┐ │
│  │  cache / errors          │   │ @gitlens/ipc (620)  IPC server   │ │
│  └───────────▲─────────────┘   └──────────────────────────────────┘ │
│              │ 实现接口                                              │
│  ┌───────────┴─────────────┐                                        │
│  │ @gitlens/git-cli (39k)  │                                        │
│  │  exec/   进程层 + 队列   │                                        │
│  │  providers/  同名实现    │                                        │
│  │  parsers/                │                                        │
│  └─────────────────────────┘                                        │
│                                                                      │
│  @gitlens/utils (20k)  ←──── 被上面所有包依赖                          │
└─────────────────────────────────────────────────────────────────────┘
                              ▼
                          git 子进程
```

**依赖方向（实测 grep 验证）**：

| 包 | import vscode | 依赖的内部包 |
|---|---|---|
| `utils` | **0** | — |
| `git` | **0** | `utils`（186 处） |
| `git-cli` | **0** | `git`（294 处）+ `utils`（200 处） |
| `ipc` | **0** | — |
| `plus/commit-graph`、`commit-graph-ui` | **0** | — |
| `src/**` | 是 | 全部 |

---

## 2. 分层架构分析

### 2.1 最核心的一条：**用包边界代替 lint 规则**

我们的 `CLAUDE.md §A`「`git/` 不得 import vscode」靠 biome 规则强制。
GitLens 把同一条约束做成了**物理边界**——`packages/git` 是独立的 npm 包，
它的 `package.json` 里根本没有 `vscode` 依赖，**想违反都 import 不到**。

理由和我们写的一字不差：换个宿主（CLI、测试、将来的 language server）都能直接用。
区别是它已经真的这么用了——`git-cli` 就是一个不依赖 VSCode 的完整实现。

### 2.2 `context.ts`：库需要宿主提供什么

`packages/git` 不 import vscode，但它要读文件、要监听、要查配置。
这些能力由宿主注入，契约集中定义在 `packages/git/src/context.ts`：

```ts
export interface GitServiceContext {
  readonly fs: FileSystemProvider;        // 读文件
  ...
}
export interface WorkspaceProvider { ... }
export interface RemotesProvider { ... }
export interface SearchQueryProvider { ... }
```

这是标准的端口-适配器：**库定义"我需要什么"，宿主提供"我能给什么"**。
我们 M2 的 `GitLogger`、M6 计划中的 watcher 注入，是同一手法的零散版本；
GitLens 把它们收拢成了一个文件。

### 2.3 `providers/`：接口与实现按域成对拆分

```
packages/git/src/providers/       22 个文件，仅 1763 行 —— 全是接口
packages/git-cli/src/providers/   同名文件 —— CLI 实现
```

域的划分：`blame / branches / commits / config / contributors / diff / graph /
maintenance / operations / patch / pausedOperations / refs / remotes / revision /
staging / stash / status / tags / worktrees`

`GitProvider` 接口把它们聚合起来，其中**核心子 provider 必选、CLI 专有的可选**：

```ts
export interface GitProvider {
  readonly branches: GitBranchesSubProvider;   // 必选
  readonly commits: GitCommitsSubProvider;
  ...
  clone?(...): ...;                             // 可选：不是每种 provider 都能 clone
  getIgnoreFilter?(...): GitIgnoreFilter;
}
```

这样 GitHub 虚拟仓库这类"不是本地 git"的来源也能接进同一套上层。
**我们只有一种 provider，不需要这层抽象**——但"按域拆分命令"这件事值得看：
它比我们 M5 的 `commands/` 更早一步做了分组。

### 2.4 `watching/`：整个监听子系统都在 vscode-free 的包里

9 个文件 1554 行：

| 文件 | 职责 |
|---|---|
| `watcherPatterns.ts` | **glob 白名单** + 噪声正则 |
| `classifyChange.ts` | 路径 → `RepositoryChange[]` |
| `gitIgnoreFilter.ts` | gitignore 过滤（`ignore` npm 包） |
| `watchService.ts` (430) | 顶层：会话生命周期、工作区 watcher |
| `watchSession.ts` (439) | 单仓库的订阅与事件推送 |
| `watchGroup.ts` (185) | `.git` / worktree 的 watcher 分组 |
| `initWatcher.ts` | 检测新仓库（`**/.git`） |
| `changeEvent.ts` / `provider.ts` | 事件类型与注入契约 |

**注入的只有一个极小的工厂**：

```ts
createWatcher(basePath: string, pattern: string, onEvent: (e: FileWatchEvent) => void): FileWatcher
```

VSCode 侧的适配只有 20 行（`src/git/gitProviderService.ts:2552-2571`）。

> **这一点比我们 M6 的设计更进一步。** 我们把「纯分类函数」放 `core/`，
> 其余（订阅、防抖、生命周期）打算放 `vscode/` 层。GitLens 把**全部**放进了包里，
> 只注入一个 `createWatcher`。结果是整个监听子系统都能脱离 VSCode 跑。

### 2.5 `RepositoryChange`：21 种变化，比我们的 4 个域细一个量级

```
unknown | index | head | heads | tags | stash | remotes | worktrees | config
| pausedOp | cherryPick | merge | rebase | revert | closed | ignores
| remoteProviders | starred | opened | gkConfig | lastFetched
```

对照我们的 `refs / worktree / stash / operation`：

| 我们 | GitLens 对应 |
|---|---|
| `refs` | `head` + `heads` + `tags` + `remotes` + `config` |
| `worktree` | `index`（+ 工作区事件走另一条通道） |
| `stash` | `stash` |
| `operation` | `pausedOp` + `cherryPick` + `merge` + `rebase` + `revert` |

它拆得细，是因为消费者多（20+ 个视图与 webview）且各自只关心一小块。
**我们现在只有两个面板，拆到 21 个没有消费者**——但这张表说明
我们的 4 个域**将来会不够用**，尤其 `operation` 那一格。

### 2.6 `container.ts`：服务定位器

971 行，把所有服务挂成惰性 getter（`get cache()`、`get git()`…）。
不是 IoC 容器，就是一个大的服务注册表。**规模到了才需要**，我们现在不需要。

### 2.7 webview 层：Supertalk RPC

`src/webviews/rpc/rpcHost.ts` + `hostEndpoint.ts`，基于 `@eamodio/supertalk`
（typed RPC，带 signals / channels / abort）。

**两个我们 M7 一定会撞上的坑，它的注释里写明了：**

1. **握手竞态**：Supertalk 的 `expose()` 只发一次 ready 信号。
   若在 webview 脚本开始监听之前 expose，客户端的 `waitForReady()` 会永远挂住。
   解法：改成**客户端宣告驱动**——webview 侧每次会话主动宣告，宿主侧检测到宣告才 expose。
2. **隐藏时 postMessage 被静默丢弃**：VSCode 在 webview 隐藏时会丢掉
   `webview.postMessage()`。`hostEndpoint.ts` 在**编码之前**拦截并缓冲，
   可见性恢复时重放。而且去重策略分两类：
   - `handler` 类（signals / events）→ **按 wireType 后写覆盖**
   - 其余（call/return/…）→ **FIFO**，因为每条都是独立的逻辑操作
   - 例外：`st:ch:*`（有序通道）虽是 handler 类却走 FIFO，
     因为后写覆盖会把序列压扁、让接收方的 `seq` 失步

### 2.8 提交图是独立产品线

`packages/plus/commit-graph`（9.8k 行：布局 / 几何 / 分页 / 投影 / 时间轴 / 无障碍 / 统计）
+ `commit-graph-ui`（21k 行，渲染，单文件 `graph.ts` 就 12k 行）。

**与 IntelliJ 把 `vcs-log` 做成独立产品线是同一判断。**
两家独立得出同一结论：**提交图大到需要自成体系。**

---

## 3. 数据流图（读路径：git → 界面）

```
git 子进程
   │ stdout
   ▼
packages/git-cli/src/exec/           进程层
   ├ exec.ts / git.ts                spawn、编码、错误
   ├ gitQueue.ts (326)               命令排队           ← 我们 M5 的对应物
   ├ locator.ts                      git 可执行文件探测   ← 我们推给 vscode/ 层的
   └ eventLoopMonitor.ts             事件循环阻塞监控
   ▼
packages/git-cli/src/parsers/        解析
   ▼
packages/git/src/models/             领域模型（46 文件 5381 行）
   ▼
packages/git/src/cache.ts            缓存
   ▼
src/git/gitProviderService.ts        跨 provider 路由、聚合
   ▼
src/git/graphRowProcessor.ts         图数据加工（图专用）
   ▼
src/webviews/rpc/  (Supertalk)       类型化 RPC
   │  ⚠ 隐藏时缓冲 + 分类去重（§2.7）
   ▼
src/webviews/apps/                   前端
```

**感知路径（外部变化 → 界面）另走一条：**

```
文件系统事件
   ▼
src/git/gitProviderService.ts:2561   createFileSystemWatcher（唯一一处）
   ▼ 注入的 createWatcher 工厂
packages/git/src/watching/watchService.ts
   ├─ .git 内：glob 白名单订阅 → shouldIgnoreRepoPath → classifyGitDirChange
   │                                                      → RepositoryChange[]
   └─ 工作区：'**' 订阅
        ├ ① shouldIgnoreWorkingTreePath  快速正则（node_modules/.git/.watchman-cookie-）
        ├ ② relativePath === '.gitignore' → filter.refresh() + 推 'ignores' 变化
        ├ ③ 过滤器未就绪 → 缓冲（**有上限**，超了标记为不完整）
        └ ④ filter.isIgnored(relativePath) → 丢弃
   ▼
watchSession.pushWorkingTreeChanges / pushRepoChanges
   ▼
Repository.onDidChange(RepositoryChange[])
   ▼
各视图 / webview 自行决定重拉什么
```

---

## 4. 控制流图（写路径：用户操作 → git）

```
用户操作（命令面板 / 视图右键 / webview 按钮）
   │
   ├─ src/commands/          VSCode 命令
   ├─ src/views/             树视图动作
   └─ src/webviews/rpc/      webview 经 Supertalk 调服务
   │
   ▼
container.ts                 取到所需服务（服务定位器）
   ▼
src/git/gitProviderService   选中目标仓库与 provider
   ▼
packages/git/providers/*     接口调用（编译期约束）
   ▼
packages/git-cli/providers/* CLI 实现
   ▼
packages/git-cli/exec/gitQueue.ts   ← 【唯一闸门】命令排队
   ▼
exec.ts → spawn → git 子进程
   │
   └─► 写操作改动 .git / 工作区
          └─► 回到 §3 的感知路径，由 watcher 通知上去
```

**注意：控制流的终点不直接回到界面。** 写完之后靠 watcher 绕一圈回来——
与我们 M6 §7 定的「不加写操作完成信号」是同一取向。
（未逐条核实它是否在某些命令上另发直接通知，但主链路是 watcher。）

---

## 5. 与另外三家的横向位置

| | vscode/git | git4idea | 旧仓库 | **GitLens** |
|---|---|---|---|---|
| 是否自己拥有界面 | 否（交平台） | 是（Swing） | **是（webview）** | **是（webview）** |
| git 逻辑与宿主是否分离 | 否，混在扩展里 | 是（模块） | 否 | **是（独立 npm 包，零 vscode 依赖）** |
| `.git` 监听 | 全订阅 + 过滤 | VFS 事件 | 全订阅 + 过滤 | **glob 白名单订阅** |
| gitignore 过滤 | 无 | 无（改为按路径缩小 status） | **无（注释里承认是缺口）** | **有（`ignore` 包）** |
| 变化分类粒度 | 无 | 标志位 → 多个 holder | 4 个域 | **21 种 `RepositoryChange`** |
| 命令排队 | `operation.ts` | `LockingPolicy` 读写锁 | **无** | `gitQueue.ts` |
| 提交图 | 交平台 SCM Graph | **独立产品线 `vcs-log`** | 自绘 SVG | **独立包 `commit-graph`** |

---

## 5.9 分页：**名为 cursor，实为 `--skip`**（2026-09-21 补，本人核实）

这是 GitLens 区别于另外两家的关键设计，也是它替我们回答了一个正确性问题的地方。

`packages/git-cli/src/providers/graph.ts`：

```ts
cursor?: { sha: string; skip: number },              // :1098
cursor?.skip ? `--skip=${cursor.skip}` : undefined,  // :1137
cursor = lastSha != null ? { sha: lastSha, skip: total - iterations } : undefined;  // :1211
```

:1646 的注释：

> `more()` (which **re-spawns git from `--skip`**) continues byte-identically off the trimmed window.

**`sha` 只当锚点/校验，定位完全靠偏移量。**

### 为什么它不用真游标（`git log <sha>`）

要复现 `--all --date-order` 的**全局顺序**，只能**重跑同一次 walk**。
`git log <sha>` 拿到的是「该 sha 可达子图的前 200 条」——多分支历史里
和全局顺序不是一回事，翻页会重复或遗漏。

**GitLens 宁可吃 O(N) 也要顺序一致。**

我们实测过（`scripts/bench-paging.sh`，16 万条合成提交）：
`--skip` 在 15 万深处 **452 ms**，真游标 **3 ms**——性能上真游标完胜。
**但 GitLens 的选择说明那 449 ms 买的是正确性，不是它没想到。**

### 三家对照

| | 首屏 | 翻页 | 全局顺序 |
|---|---|---|---|
| **GitLens** | 有界读 | `--skip` 重跑 walk | ✅ 保证 |
| **IntelliJ** | `readFirstBlock`（`--max-count`） | — | ✅ 另有 `readAllHashes` 后台全量 |
| **旧仓库** | 200 条/页 | `loadMoreLog` + `LaneSnapshot` | ⚠️ 靠跨页可变状态维持 |

**我们取 IntelliJ 的两阶段**（`design/S1-log-panel.md` §0.4）：
首片只做有界首屏，全量骨架推到第二片。翻页用 `--skip`，与 GitLens 一致。

---

## 6. 对我们的启示（按可落地程度排序）

### 6.1 立即可用（M6）

1. **`.git` 监听改 glob 白名单**（§2.4 `watcherPatterns.ts`）。
   我们现在是「全订阅 + JS 过滤 `objects/`」，一次 `fetch` 要接收上千个事件再丢弃；
   白名单让它们**根本不到达**。
2. **补分类表缺口**：`sequencer/**`（多提交 cherry-pick/revert，**我们会漏判 `operation`**）、
   `shallow`、`refs/replace`。
3. **补噪声规则**：`fsmonitor--daemon/`、`.watchman-cookie-`、
   `git-rebase-todo`（交互式 rebase 时用户每存盘一次就刷一次）。
4. **gitignore 过滤从「不做」改为「做」**，用 `ignore` 包，
   **并加上 GitLens 缺的那道防护**：被强制跟踪的 ignored 文件不能丢。见 §6.2。

### 6.2 推翻了我们之前的一条判断

此前结论是「三家都不过滤 gitignore，所以不要自己实现——必然与 git 不一致」。
**GitLens 做了，而且论证是成立的：**

- 它只加载**根目录** `.gitignore` + `info/exclude` + `core.excludesFile`，
  **不加载子目录的 `.gitignore`**；
- 于是漏判方向是「该忽略的没忽略」→ **多刷一次，无害**；
- 危险方向（把没忽略的当忽略 → 改动看不见）靠**用成熟库而非手写**控制。

我当时把「必然不一致」等同于「必然危险」，漏了方向性。

#### ⚠️ 但它有一个真的洞：被强制跟踪的 ignored 文件

`git add -f app.log` 之后，`app.log` 既被跟踪、又匹配 `.gitignore`。实测（git 2.43）：

```
git check-ignore app.log              → exit 1   不算忽略（因为它被跟踪了）
git check-ignore --no-index app.log   → exit 0   纯模式匹配才算
git status                            →  M app.log   照常报告改动
```

**git 的「忽略」是认 index 的；纯模式匹配不认。**
而 `ignore` npm 包做的就是纯模式匹配（等价于 `--no-index`）。

于是 GitLens 的链路是：
改动 `app.log` → `isIgnored()` 返回 true → 事件丢弃 → status 缓存不失效
（`packages/git/src/cache.ts:797` `onWorkingTreeChanged` → `incrementStatusGeneration`）
→ **用户的改动不显示**。

在 `packages/git/src/watching/` 里搜 `tracked` / `force`，**没有任何防护**。

#### 便宜的补法（我们该做，它没做）

git 自己能一次性给出这个例外集合：

```
git ls-files -i -c --exclude-standard     # 被跟踪 且 匹配 ignore 规则的文件
```

实测在 `~/Projects/vscode`（163k 提交的大仓库）上 **140–160 ms，返回 1 个文件**。
（⚠️ 该目录已不在本机，数字无法复现；恢复办法见 `tech/performance.md` §0）
通常是空集。

做法：
1. 维护一个例外集合，来源就是上面这条命令；
2. **只在 `.git/index` 或 `.gitignore` 变化时重算**（两者我们本来就在监听）；
3. 过滤判断改成 `isIgnored(path) && !exceptions.has(path)` 才丢弃。

代价可忽略，把唯一的危险方向堵死。

### 6.3 中期（M7）

5. **webview 隐藏时 postMessage 被静默丢弃**——必须缓冲重放，
   且去重要分类（signals 后写覆盖 / 调用回复 FIFO / 有序通道 FIFO）。§2.7
6. **RPC 握手不能靠宿主单方 ready**，要客户端宣告驱动，否则会永久挂住。§2.7
7. `context.ts` 那种**把宿主契约收拢到一个文件**的做法，
   比我们零散注入（`GitLogger`、watcher 工厂…）更好管理。

### 6.4 结构性、但现在不动

8. **包边界代替 lint**：把 `git/` 做成独立 workspace 包，物理上 import 不到 vscode。
   我们已有 lint 规则，收益是增量的；等真需要第二个宿主时再说。
9. **`RepositoryChange` 21 种 vs 我们 4 个域**：现在没有那么多消费者，
   不拆。但记着我们的 `operation` 这一格将来会不够用。
10. **提交图独立成包**：GitLens 与 IntelliJ 独立得出同一结论。
    这是首片「Log + Graph」要不要拆成两片的又一条证据（`PLAN.md` 已登记）。

### 6.5 明确不借鉴

- **服务定位器 `container.ts`**（971 行）——规模到了才需要，我们现在是负担。
- **多 provider 抽象**（接口/实现成对拆分）——我们只有本地 git 一种来源。
- **Supertalk 依赖**——协议我们自己定（M7 决策 B 的泛型映射式），
  但它的两个坑（§6.3 第 5、6 条）要吸取。
