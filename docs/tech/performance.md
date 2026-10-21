# 非功能需求（性能）

> 面向公开发布，任何人的仓库都要能用，所以指标按**最坏的真实仓库**定。本文数字全部实测，不是估计。
> 凡是实测数字，都要同时记下**在什么上测的、怎么再测一次**。

## 1. 基准仓库

VS Code 源码仓库：**163,428 个提交（`--all` 口径 188,163），5,580 个引用**，代表用户可能打开的大仓库。
更极端的参照：Linux kernel 约 130 万提交。本机现在没有这两个仓库，要重测时先取：

```bash
git clone --bare https://github.com/microsoft/vscode ~/bench/vscode.git   # ~16 万条
git clone --bare https://github.com/torvalds/linux  ~/bench/linux.git     # ~130 万条
```

`scripts/bench-paging.sh` 用合成仓库测形状（`--skip` 是不是 O(N)），不需要下载，但不能测绝对数字。

## 2. 常规读取不是问题（git 2.43，SSD）

| 操作 | 耗时 | 随仓库增大变慢吗 |
|---|---|---|
| `log --max-count=200` | 11 ms | 否（凑够就停） |
| `log --all --max-count=200` | 73 ms | 几乎否 |
| `for-each-ref`（5,580 个引用） | 6 ms | 线性，基数小 |
| `status --porcelain=v2 -z -uall` | 13 ms | 随工作区文件数；两万个被忽略的文件时仍 < 10 ms（目录级就判定忽略） |
| `--since=1.month` | 2 ms | 否 |

我们自己的命令（含解析）：

| 命令 | 耗时 |
|---|---|
| 全量骨架 188,163 条 | 1,937 ms，常驻约 360 MB（约 1.9 KB / 条，含 Node 基线） |
| `getCommitDetails` 200 条 | 11 ms |
| `getStatus` | 19 ms |

全量骨架现在截断在 1 万条（`SKELETON_LIMIT`），约 20 MB。不截断时 Linux kernel 量级会到约 2.5 GB，**失败形态是扩展宿主 OOM，不是慢**。
第 8 阶段画图若要更多，压缩表示的方向：提交用整数标识、每行用 `Uint32Array` 等原始类型数组、hash 平铺成二进制、「单父单子」的提交用位图标记。

**瓶颈不在 git，在我们自己的渲染**：提交列表、分支树、文件树都要虚拟滚动。

## 2.1 提交图布局（第 8 阶段）

调试场景 `graph-large`（10,500 个提交，同时最多 6 个分支反复分出合回），骨架一万条，webview 的纯函数在 Node 里跑（同为 V8）：

| 阶段 | 首次 | 之后中位 |
|---|---|---|
| 行号图 `buildStructure` | 8 ms | 3 ms |
| 编号 `buildLayout` | 14 ms | 3 ms |
| 颜色 `buildColors` | 1 ms | 0.4 ms |
| 每行的位置 `buildGraph`（90,181 段线） | 38 ms | 27 ms |
| **合计** | **61 ms** | **34 ms** |

筛选时另算可见的线（`visibleLines`，两趟线性扫描）：同一仓库每 2 条留 1 条为 7 ms、每 10 条留 1 条为 4 ms；行数少了，`buildGraph` 也跟着变快（11 ms、2 ms）。行号图、编号、颜色不随筛选重算。

骨架或 refs 变了才整个重算，在可接受范围，**不改成按可见行懒算**。
大头在 `buildGraph` 的逐行排序；车道更多的仓库会变慢，到时先看它。

## 3. 唯一的性能悬崖：过滤（第 5 阶段）

| 操作 | 耗时 |
|---|---|
| 按作者过滤，该作者很活跃 | 53 ms |
| 按作者过滤，**无匹配** | **1,301 ms** |
| `--grep` 有匹配 | 18 ms |
| `--grep` **无匹配** | **1,227 ms** |

`--max-count` 限制的是输出条数，不是遍历范围：匹配少时 git 要走完全部提交才能确定没有更多了。Linux kernel 量级约 10 秒。
只有日期过滤天然安全（提交按时间有序，走到就停）。

**限在骨架那一万条里之后**（`tech/architecture.md` 第 8 题，`log --no-walk --stdin`）：本机 8,741 条的仓库（1.2 GB pack），
`--grep -F -i` 无匹配 69～78 ms、有匹配（1,710 条）71 ms——有没有匹配都一样，悬崖没了。
再测：`git log --format=%H HEAD --branches --remotes --tags --date-order --max-count=10000 > h.txt`，
`time git -c log.showSignature=false log --format=%H --no-walk --stdin -F -i --grep=<词> < h.txt`。
一万条以上：用 `git fast-import` 造的 30,000 条线性仓库（每条改一个文件），只查最近一万条——
说明文字无匹配 39 ms / 全中 49 ms，作者 40～44 ms，路径 72 ms（有无匹配一样）；同一仓库不限条数查全部历史 102 ms，随总条数线性涨。
说明文字与作者只读提交对象，与树的大小无关；路径要比树，在一个真实的大仓库上补测：路径 26～32 ms、作者 72 ms。
结论：限在一万条之后，几种过滤都在 100 ms 以内，有无匹配一样，不随仓库总条数增长。

硬性要求：
- 过滤输入必须**防抖**，不能每敲一键发一次查询。防抖同时承担了「取消」要解决的大部分问题；防抖不够时再接线取消（进程层已支持）。
- 过滤查询运行时要有**明确的进行中反馈**：1～10 秒的静默会被当成卡死。

## 4. watcher 事件时序

`node scripts/demo-watch-timing.mjs`，小仓库上一次 `commit`：

| 测量项 | 结果 |
|---|---|
| 命令耗时 | 9 ms |
| 命令返回后才到达的事件 | 0 个（全部在返回前 2～5 ms 到齐） |
| 事件簇跨度 | 3.3 ms |
| 原始事件 / 滤掉噪声后 / 有效路径 | 27 / 10 / 5（`COMMIT_EDITMSG`、`logs/HEAD`、`logs/refs/heads/main`、`refs/heads/main`、`index`） |

150 ms 防抖窗口是跨度的 45 倍。不再下调：VS Code 自己的文件事件批处理层（这里测不到）延迟未知，窗口小于它的周期反而会被拆成多次通知。

## 5. 已知缺口：Windows 下取消不完整

POSIX 下取消对整个进程组发信号（`detached: true` + `process.kill(-pid)`），连 git 起的子进程（钩子、凭据助手）一起杀。
必须杀整个组：`cli.ts` 监听的是 `close`（为了不丢未读完的输出），`close` 要等所有持有管道的进程都退出。
实测 pre-commit 钩子 `sleep 3`：只杀 git，`close` 仍要 3004 ms；杀整个组，305 ms。

Windows 没有进程组信号，退回只杀直接子进程，取消在有慢速子进程时失效。要支持 Windows 时用 `taskkill /pid <pid> /T /F`。

## 5.1 面板展开（2026-10-21）

不保留页面时，每次展开 Log、Commit 面板都先黑屏，再一下子出来，体感半秒到一秒，小仓库也一样。

在页面里打点（扩展开始建视图、iframe 开始加载、脚本跑完、发第一个请求、数据到、画出来，时间回报到扩展日志），F5 调试窗口、`context-menu` 场景（几条提交）：

| 重新展开 | iframe 开始加载 → 脚本跑完 | → 数据到 | → 画出来（合计） |
|---|---|---|---|
| Log（3 次） | 21～27 ms | 104～133 ms | 110～130 ms |
| Commit（2 次） | 24～38 ms | 93～151 ms | 110～160 ms |

- iframe 开始加载之后我们自己只占 110～160 ms，大头是取数据；脚本、样式、字体只有二三十毫秒。
- 重新展开时扩展的 `resolveWebviewView` 根本没被再调（写在页面里的「开始建视图」时刻一直是第一次的），VS Code 拿存着的 HTML 直接重建 iframe。黑屏在 iframe 开始加载之前，是 VS Code 自己的，从点击到这一刻页面和扩展都量不到。
- 所以「先画框架、数据后到」最多省 100 ms 左右，省不掉黑屏；改成收起时保留页面（`retainContextWhenHidden`），再展开不重建，实测没有黑屏、没有新的页面加载（日志里只有窗口刚打开时的两次）。

再测：在 `main.ts` 开头、Vue 挂载后、`onMounted` 发第一个请求前、`load` 完成后两帧各记一次 `Date.now()`，加上 `performance.timeOrigin`，用 `reportError` 发回扩展日志（`~/.vscode-server/data/logs/<会话>/exthost*/zjqtzzc.dummy-git/Dummy Git.log`）；扩展在 HTML 里写下开始建视图的时刻作对照。测完撤掉。

## 6. 尚未测量的

- 有几万个改动的工作区的 `status`
- 单个提交改动数千文件时的详情加载
- 大仓库上 commit 的事件簇跨度（上面是小仓库）
- Windows 与网络文件系统
