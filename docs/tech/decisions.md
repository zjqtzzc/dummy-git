# 决策记录

> 决策的**内容**在 `CLAUDE.md`（强制规则）与 `tech/architecture.md`（技术选型），本文只记其余的**为什么**和**否决过什么**。
> 只留对当下仍起指导作用的条目；过时的直接删，不留历史。

## 总则：前端初始化时主动向后端要数据

扩展侧**永远不主动推数据**。它只做两件事：回答请求、广播「什么过期了」。

| 情形 | 做法 |
|---|---|
| 面板首次打开 | 前端 `ready` → `getRepositories` → 按需拉 |
| 面板隐藏再显示（webview 重建） | 就是一次新的初始化，前端自己再要一遍，不需要特殊处理 |
| 仓库变了 | 广播只说「哪些域过期了」，**不带新数据**；前端自己决定要不要再要 |
| 前端要知道 `repo` | 问 `getRepositories`，不靠 HTML 注入、不靠推送 |

算新值要秒级、几百 MB，而此刻可能根本没人在看那个面板——**只有前端知道自己要不要**。

`getRepositories` 是唯一不带 `repo` 的命令：它就是用来回答「有哪些 repo」的。
否决过把仓库路径写进 HTML（`data-repo`）：那是把「有哪些仓库」的答案烤进页面、由扩展替用户选好；
多仓库时面板要列出来让人选，返回值从一条变多条，面板与协议都不用动。

## 工作方式

- 按阶段推进（`product/roadmap.md`），每阶段先定细节（`phases/phase-NN.md`）再实现。
- 实现「一步一件小事」：每步讲为什么，用户确认后单独提交。用户目标是理解每一行，理解优先于速度。
- 文档在 `docs/`，随仓库流传；参照源码是本地副本（`.notes/`，不进版本库）。代码注释不引用文档（`CLAUDE.md` F）。

## 扩展身份

名字 **Dummy Git**（界面文案统一用英文），ID `zjqtzzc.dummy-git`，命令与视图前缀 `dummyGit.`，workspace scope `@dummy-git/*`。
定位是「不用记命令、懒人和外行都能用」，对标「傻瓜相机」。否决过：Turtle Git（无信息量）、Lazy Git（撞 lazygit）。
本地目录与 remote 仍叫 `turtle_git`，不改（改目录会打断在用的工作区路径）。不需兼容任何旧扩展的持久化状态。

## 类型策略：已否决的方案

- **branded string**（`type Sha = string & {__brand}`）：是给错误的模型打补丁。正解是 tagged union 建模，让错误状态无法被表达。
- **数值 enum**：诉求是使用纪律而非底层表示；数值 enum 引入序列化重排风险且损害可调试性。
- **wire codec 层**：它的存在理由是数值 enum 的重排风险；string enum 值绑定成员名，重排无害。
- **自描述 token 值**（`'ResetMode.Mixed'`）：为机械强制「值只承担身份」而引入，过度复杂。
  代价：该条成为 `CLAUDE.md` 中唯一不由机器保障的规则，靠映射表纪律 + 审阅落地。

TS 5.0 起全字面量 enum 为 union enum（前提是禁计算成员）。`erasableSyntaxOnly` 禁止 enum，本项目不开。

## 不要 CI，直接提 main

单人本地项目，remote 只作备份，没有 PR 流程。四项检查（typecheck / lint / test / build）提交前本地执行（`CLAUDE.md` E）。
否决过保留 workflow「以后可能用」：无人看的绿灯比没有 CI 更有误导性，需要时再加是 20 行 yaml。

## 日志不脱敏

`GitLogger` 不对 remote URL 里的凭据做脱敏。已知风险：`https://user:token@host/…` 会原样进输出面板，
用户把日志贴出去即泄漏 token。用户明确决定不做。

## 进程层

- **非零退出码返回而不抛**（`cli.exec`）。退出码是数据：`diff --quiet` 的 1 是「有差异」，`rev-parse --verify` 的 128 是「引用不存在」。
  「失败即抛」由 `run()` 包一层提供，是命令层的默认入口；`run()` 不提供「某些退出码视为成功」的开关——
  那种逃生口会让调用方写出永不可达的分支。
- **不设 `GIT_CONFIG_NOSYSTEM=1`**：企业环境的代理、credential helper、`http.sslCAInfo` 常配在系统级，
  忽略它们 = 扩展行为与用户命令行 git 不一致，比「不可复现」更糟。
- **只有 `execRaw` 一条路，没有流式 `stream()`**：两条路会让每个调用方做一次选择，而且会选得不一致。
  出现真正需要提前终止的消费者（实时回显、边读边判断何时停）时再加。
- `run()` 放在 `failure.ts` 而不是 `cli.ts`：它需要 `classifyError`，放进程层会让进程层反向依赖分类层。

## 解析与错误分类

- **parser 遇未知值抛 `GitParseError`**，带足诊断（哪个 parser、第几条记录、原始字节）。
  否决「加 `Unknown` 变体优雅降级」：每个调用方永远要处理这个分支，且把解析事故变成数据结构里的合法状态。
- **错误分类遇认不出的 stderr 返回 `undefined`**，与 parser 刻意不对称：git 的错误文案本来就是开放集，认不出是常态。
  同理不设 `Unknown` 成员。
- **错误码只有两个**：`NotAGitRepository`（`Repository` 据此置 Disposed，唯一带来行为差异的码）、
  `RepositoryIsLocked`（原始 stderr 第一行会误导，有用的解释在第三行）。
  判据：**加一个码的前提是下游会据此做不同的事**，「把 stderr 显示出来」不算。
  留着没有消费者的码比缺一个更糟——它会让人误以为「这里已经处理过了」。
- 需要命令上下文才能判定的错误（cherry-pick 冲突与 stash 冲突的 stderr 可能一样）归命令层，不在分类函数里猜 `args[0]`。
- **锁冲突只分类、不重试**。实测持有 `index.lock` 时只有 `add` / `commit` / `checkout` / `stash` 这类写命令失败，
  而我们自己的写命令已排队，撞锁只可能是用户在别处同时写——该告诉用户，不该掩盖，重试也是对一个正在变化的仓库重试。
- **不解析 stderr 里的进度行**：git 在管道里默认不输出进度，要显式 `--progress`；进度用 `\r` 不是 `\n`；
  真做确定进度时成本是把流式读取加回来。「正在做 / 做完了」只需要一个布尔值。

对着参照实现做设计，默认动作是「先不要」，而不是「先照抄」：多次查下去发现它服务的需求我们没有。

## 数据结构：数据层都提供，应用层决定怎么渲染

**数据层丢掉的信息应用层拿不回来，应用层不想显示的字段随时可以不显示**，所以默认给全。
边界是**携带成本**：同一次调用顺手就给、且已经在解析的 → 提供；要多跑一条命令或多写一段解析的 → 不提供。
据此 `Commit.committer`、`Ref.annotated` 保留；`FileChange` 同时保留暂存区与工作区两列——
提交时「只对未跟踪文件 `add`」就靠这个区分，数据层丢掉它，动作层再也补不回来。

`CommitFileChange` 不复用 `FileChange`：一条已存在的提交没有「暂存区 / 工作区」两个维度，复用就得编造值，编造的值会被下游当真。

`shared/` 按概念分文件（`commit.ts` / `ref.ts` / `change.ts`），不按语言构造分（不设 `enums.ts`）。

## `git status` 用 `--porcelain=v2`

v2 每行第一个字段就是记录类型（普通 / 重命名 / 冲突 / 未跟踪），正对应 `FileChange` 的 `kind`；
v1 要从 `XY` 的值里猜身份，且「先判冲突码、再拆两列」的顺序写反就会让 `AA` 出两条记录，编译器管不了。
代价：行更长，要求 git ≥ 2.11。

## 最低 git 版本：**2.25**（Ubuntu 20.04 自带的 2.25.1）

2026-10-16 用户定：要支持的最老系统是 Ubuntu 20.04。功能上的下限是 2.23（下面几条），但只有 2.25 是真跑过测试的，所以定 2.25；
2.25 以上才有的东西不能用（`--pathspec-from-file` 2.26、`init -b` 2.28、SSH 签名 2.34、`stash push --staged` 2.35）。
`pnpm test:old-git` 在 Ubuntu 20.04 容器里跑全量测试（`scripts/old-git/`）；否决借用户自己干活的容器跑（会动别人的环境）。
2.25 上实测与 2.43 不同的：`--first-parent` 不给 merge 出 diff（2.31 起才给）、rebase 默认走 apply 后端（2.26 起改 merge）、`check-ignore` 把 `!` 否定规则匹配的也报成忽略，见 `tech/traps.md`。

几个约束同时生效，取最高的：
- ≥ 2.11：`status --porcelain=v2`
- ≥ 2.15：`GIT_OPTIONAL_LOCKS`（锁策略两态的前提）
- ≥ 2.16：`for-each-ref` 的 `%(upstream:remotename)` / `%(upstream:remoteref)`
- ≥ 2.23：`git restore`（Rollback）。一条 `restore --source=HEAD --staged --worktree` 覆盖修改、删除、新增、改名（实测）。
  否决过留在 2.16、按类型拼 `checkout` / `rm`：逻辑绕一截，换来的只是 Ubuntu 18.04（2.17）、Debian 10（2.20）两个已停止维护的系统。

逐条命令的版本要求在 `packages/extension/src/git/commands/index.ts` 的表里，新加命令时在那里加一行；
某行超过这里的下限时，先改这一节。不做运行时版本检测。

## 并发与锁

- **不做「取消正在跑的 git 命令」**：写命令全是本地的、网络命令不占写锁，残余风险只剩 pre-commit 钩子挂死。
  进程层已支持 `AbortSignal`，将来接线即可。
- **网络命令走远程道，不走本地道**（`LockPolicy.Remote`，tech/architecture.md 第 12 题）：push 不改暂存区与工作区，并发 commit 最坏结果是「这次没推上去」；拉取当前分支的 merge 改 index 与工作区，进本地道。
- **锁每仓库一把**：锁是 `Repository` 实例上的字段，零成本；改全局反而要模块级单例。
  已知盲区：同一仓库的多个 linked worktree 共享 `refs/`，每仓库锁挡不住并发改同一引用（git 自己对 ref 有锁）。
- **协议与广播每条都带仓库标识**：单仓库下它不改变行为；协议是最贵的改动面，现在加是一个字段，将来加是重写契约。

## 刷新

- **不加「写操作完成」信号，刷新完全由 watcher 驱动**：外部终端的操作反正只能靠 watcher，两条路会回答同一个问题；
  这个信号唯一买到的是去掉 150 ms 防抖。回来的条件（同时满足）：实测看得见操作后的呆滞，且缩小防抖窗口已不足以解决。
- **域的粒度上限 = watcher 从路径能分辨的粒度**。`.git/refs/heads/main` 变了，分不出是新提交、改名、`reset --hard` 还是删分支，
  所以 `refs` 是最细的；再细就是在域这层撒谎。反过来，能分辨的就该分——所以 `operation` 单独成域：
  Banner 重拉只要几毫秒，refs 重拉是秒级，rebase 每推进一步不该连带重算提交图。
- **`refs` 域内部代价差两百倍，不在域这层解**：提交图收到「refs 过期」后先比对 ref 指向的 hash 集合，
  集合没变则提交集合必然没变，跳过骨架重拉（做提交图时实现）。
- **工作区的 ignore 过滤问 git，不自己做模式匹配**（`core/ignoreCache.ts`）：没答案就放行并攒着，批量 `check-ignore`。
  否决纯模式匹配的库：它等价于 `--no-index`，会把 `git add -f` 强制跟踪的文件误判成忽略，用户改了看不见；
  这个洞可以用 `ls-files -i -c --exclude-standard` 的例外集合补，但还要自己维护例外、且不加载子目录的 `.gitignore`；
  `check-ignore` 默认认 index，结构上没有这个坑。
- **被忽略的目录整个记住**：问 git 时连上级目录（带结尾 `/`）一起问。只按路径记时「每次构建一次刷新」不成立——
  编译一个编译单元一个编译单元地写新文件名，间隔常超过 150 ms 防抖窗口，几分钟的编译就一直在刷。
  目录下有被跟踪的文件时 git 不认这个目录被忽略，`add -f` 的文件不会被挡。
  否决「先等 `check-ignore` 答完再决定放不放行」：新路径的刷新都要多等一次子进程，编译期间子进程照样每个窗口起一次。
- **忽略规则变了，缓存不清**：编辑器开着时把忽略的东西改成不忽略，它的改动要等别的刷新带出来，只是晚、不会错，且少见。
  所以不监听 `.gitignore` / `info/exclude` 去清缓存，`.git` 白名单里也不订阅 `info/exclude`。
- **`.git` 订阅用 glob 白名单**，`objects/**` 的事件根本不到达；`classify.ts` 的噪声规则保留作兜底（glob 表达不了 `*.lock`）。
- 提交列表显示 git 的 `--date-order`，不在本地重排。

## 代码组织

- **`vscode/` 里凡能与 vscode API 分离的纯逻辑，单独成文件**，判据是那个文件能不能不 import `vscode`。
  这样「Windows 上对不对」能在 Linux 上测（`relativePath.ts`）。否决过用 `node:path`：它在 Linux 上不认 `\`，同样测不了。
- **不设 `features/` 目录**：「每条命令怎么执行」由 `ipc/handlers.ts` 一张表承担，一次性给全正是它的价值。
  等它真长到需要按功能拆时，再按那时的形状定规则。
- **关掉 Biome 的 `useLiteralKeys`**：它要求 `obj.k`，与 tsconfig 的 `noPropertyAccessFromIndexSignature`（索引签名必须 `obj["k"]`）直接冲突，保留 TS 那条。
- **Biome 打开 Vue 完整支持**（`html.experimentalFullSupportEnabled`）：不开时 Biome 只看 `<script>`，把模板里用到的函数误报成未使用，
  且 `--write` 会把它们删掉。`biome.json` 不能写注释，理由只能记在这里。
- **`switch` 的穷尽性检查要对准被 switch 的那个值**：只有带 `kind` 的联合类型才会把整个对象收窄成 `never`，普通结构要写 `assertNever(x.field)`。

## 原生右键菜单是协议的第二个入口，不是第二套流程

VS Code 的 `webview/context` 菜单项被点时，VS Code 直接调扩展里注册的命令，参数是页面元素上 `data-vscode-context` 的 JSON——不经过 Router。
所以菜单命令只做薄薄一层：用同一张参数校验表（`protocol.guards.ts` 的 `parseParams`）把 context 校验成某条协议命令的参数 → 调同一个 handler → 出错交给同一个错误关口（命令注册包装）。
执行逻辑、校验、错误出口都只有一份；菜单能做的事都登记在协议表里，按钮或双击以后也能走 Router 用。CLAUDE.md C.1 随之改为「webview 来的数据有两个入口，用同一张校验表」。
否决过：菜单命令自己写执行逻辑（两套并行）；菜单命令转发回页面再走 Router（绕一圈，且要页面活着）。

## 右键菜单的排序与分隔

所有右键菜单按「作用由轻到重」分组，组间分隔线：① 切换 / 查看类（不改内容或最常用）② 同步类（Pull、Push）③ 新建 / 修改类（可撤回）④ 删除类（找不回来，永远最下、单独一组，免得手滑）。
组内按使用频率排。只有一两项时不加分隔线。落地为 `package.json` 菜单项的 `group`：`1_switch` / `2_sync` / `3_edit` / `4_delete`（stash 的取回类叫 `1_apply`），组内 `@1`、`@2` 排序。
分支菜单：Checkout ｜ Pull、Push ｜ New Branch from Here…、Rename… ｜ Delete（同 IDEA 的顺序）。
不可用的项不出现（`when` 条件），不置灰。

## 需求只有一份：`product/` 下的路线图、需求池、永不做

每个阶段一句验收句，自成一体、不引用别的文件。否决过保留旧清单的 ID 体系做交叉引用：两份清单并存，必然有一份过期。

## 代码注释只解释我们自己的代码

注释写这段代码做什么、为什么这么做、坑在哪。不引用参照实现的文件与行号，不提旧仓库，不叙述「当时 / 后来」的过程。
来历有价值的，写进本文或 `tech/architecture.md`，而且只写对当下仍起指导作用的。
也不引用 `docs/` 里的文档（2026-10-16 用户定）：文档会重组，引用悄悄失效；道理直接写进注释。例外：lint 报错指向规则、大模块文件头指向顶层设计。

## 图标：自己画的一律是线条，照 IDEA 的形状

`logic/icons.ts` 的 `ICON_STROKES` 表：16×16、线宽 1、`currentColor`，每个图标是几条 path。codicon 没有的、或 IDEA 的更好认的，自己画。
IDEA 新界面的图标很多是把线条描成了填充轮廓：照形状**重画成线条**，不往表里加填充路径（否决：表里也放填充 path，原样搬 IDEA 的——两种画法并存，粗细对不齐）。
旧插件 `webview/src/shared/components/Icons.tsx` 里还没搬的，用到时照上面的办法搬，别另找：
- 第 5 阶段跳转（若做按钮）：Locate（准星）
- 第 7 阶段冲突组标题行：Continue（»）、Abort（×）——原图是白色画在彩色底上，搬时改为绿色和红色，取主题里的语义颜色。Skip（›）不做（进需求池），不搬
- 第 7、9 阶段：CherryPick、Edit（改说明）、Patch、Diff
- 以后可能用：ViewOptions（眼睛）、Settings、Refresh、Copy、Star、History（Paths 过滤或文件历史）
codicon 的照抄版（Clear、History 等）不用搬，codicon 字体本来就有。Rollback、Delete 也不搬：codicon 的 `discard`、`trash` 够好。

## 进行中的操作：继续与放弃在冲突组的标题行

选：继续和放弃放在冲突组的标题行（`phases/phase-07.md` A 批）。
- 否决顶部横幅：顶部只放 Commit / Stash 切换；继续能不能点取决于冲突，按钮放在冲突旁边关系最直接。
- 否决 IDEA 的模态冲突弹窗：webview 做不出能放文件列表的模态框；另开一个页面会和冲突组重复。IDEA 自己也在改成在文件树里显示冲突（`vcs.non.modal.merge.enabled`）。
- 否决最后一个冲突解决后自动继续：用户就没机会再看一眼说明。
- 否决「Commit 按钮直接变成继续」（VS Code 的做法）：继续已经在标题行，两个控件不应回答同一个问题。
- 否决「Amend 不管」：勾上 Amend 会把说明框换成上一次提交的说明，继续时会拿错说明。
- 否决 `git ${kind} --continue` 这种拼接写法（GitLens 的做法）：违反 CLAUDE.md B.2，改用显式映射表。
- 不拦 Stash 和 Rollback：git 自己不拦，我们也不拦，坑记在 `tech/traps.md`。

## D.6(a) 放宽：消费者已排进当前阶段实现顺序的，可以先加

第 8 阶段第 1 步加 `missingParents`（第 7 步截断处用）时定（2026-10-14）。理由：开发流程完整，一个模块的字段一次给全，免得后面回头改同一个文件。
界限是「写得出第几步」：当前阶段 `phases/phase-NN.md` 的实现顺序里有它的消费者；以后阶段的、需求池里的仍不算。
否决：维持只认已存在的消费者——实现顺序已经定好、用户确认过，「等它存在」只是把同一处改动拆成两次。

## 提交图的宽度：照 IDEA 每行退让，长线隐藏中间

选：图画在 Message 单元格里，每行宽度 = max(本行最右元素, min(6, 推荐宽度))；跨度 ≥ 30 行的线只画两头带箭头（`phases/phase-08.md` 第 1 条，IDEA 见 `refs/git4idea.md` §7.1、§7.4）。
- 否决整列一个公共宽度、只有超出上限的行退让：没有长线隐藏时，老历史里拉上来的长线让大部分行都超出上限。
- 否决按可见行定宽：滚动时整列跳。否决固定宽度：车道少时空一大块。
- 长线隐藏因此从需求池挪进第 8 阶段；「显示长线」开关留在池子里。

## F5 调试仓库：独立仓库 + 场景，不用 worktree

调试窗口打开的仓库由 `scripts/debug/setup.mjs` 按场景从零建（机制见 `process/manual-testing.md`）。
否决过本项目的 linked worktree：detached HEAD 只隔离了提交，`refs/heads`、`refs/stash`、配置整库共享——
调试窗口里删分支、drop stash 动真实仓库；`main` 已在主 worktree 检出，切不过去；进行中的 rebase 重置不掉。
否决过复用 `fixture.mjs` 的固定身份与时间：手测要贴近日常，「User: Me」「最近 24 小时」在固定值下匹配不到。
否决过 F5 弹 `pickString` 选场景：名单要在 `launch.json` 再抄一份，且同一轮手测每次 F5 都要多点一下。

## 提交图的颜色：主题变量 17 种，不算色相

选：颜色 id 照 IDEA（主链 = 分支名 hash，片段 = 编号，无 ref 的头 = 默认色），调色板 = `scmGraph.foreground1`–`5` + 终端六种色相各两档，全是主题变量。
- 否决照 IDEA 按 id 算色相：数量不限，但细线上人眼只分得出十来种；「在背景上看得清」变成我们的责任，要按深浅高对比各配参数。IDEA 的片段实际只有 10 种色相。
- 否决只用 5 种 `scmGraph` 色：每 5 个分支撞一对。否决 `color-mix()` 混色：中间色与原色接近、易发浊。
- 取余放在界面的调色板里，`color.ts` 只给身份（CLAUDE.md B.2）。

## ref 标签：目标是扫一眼看出分支头分布，不照抄 IDEA 的吊牌

选：codicon + 按类型着色（主题 `charts.*`），无边框；合并标签写「远程 & 本地」；放不下时用递增 `flex-shrink` 从后往前截到只剩图标。
- 否决边框盒子：图标已经是分隔，框多占宽度、22px 行高里显得重。
- 否决照 IDEA 自画吊牌并叠画（HEAD 黄 + 本地绿 + 远程紫）：要自绘 SVG 和遮罩挖空（行背景随悬停/选中变化，不能填底色），而「看出分支头分布」颜色 + 文字已够；留在池子。
- 否决 IDEA 写死的颜色：浅色主题上黄色看不清，高对比主题不合规；`charts.*` 每个主题都有。
- 否决按宽度把放不下的组收成一个叠画图标：要逐行量文字宽度，虚拟列表里随宽度重算；CSS 收缩系数已能做到前面的优先。
- 否决按名字猜跟踪关系（IDEA 无 upstream 时找 `<remote>/<本地名>`）：`Ref.upstream` 已经回答「谁跟踪谁」。

## refs 过期：照样重拉骨架，内容没变才沿用旧数组

选：同 vscode-git-graph，重拉后逐条比 hash / 父提交 / 时间，全同就沿用旧数组，下游 computed 与筛选查询都不动。
- 否决「ref 指向的 hash 集合没变就不拉骨架」：`shallow` 与 `refs/replace` 不改 ref 却改图，会显示过时的图；省下的 `git log` 未实测是否值得。
- 否决 IDEA 的「只拉最近一段 + 拼接，拼不上 ×5 再试、再不行全量」：拼接与回退逻辑的量远超收益。

## Log 左栏竖按钮：New / Pull / Delete / Fetch，Push 只在右键菜单

选：Delete 删选中的分支，规则与右键菜单同一个纯函数（`deleteTargetOf`：非当前的本地分支、远程分支），确认由扩展问。
- 否决 Push 留在按钮区：推送会影响别人、比 Pull 少用，右键菜单够了（用户 2026-10-14 定）。

## Pull 改名 Update（界面、协议、git 层三层一起）

选：同 IDEA 的 Update Selected——只取选中分支跟踪的远程分支，能快进就快进，分叉问变基或合并。按钮 `Update Selected`、右键 `Update`、请求 `update`、命令 `dummyGit.updateBranch`、`git/commands/update.ts`。
- 否决叫 Pull：会被当成 `git pull`（取整个远程、只作用于当前分支、按配置合并）；IDEA 的 Pull 也是另一个带对话框的功能。
- 否决只改界面文字：界面与代码各叫一个名字，读代码要多翻译一次。
- 图标 `AppIcon.Pull` 不改：它描述箭头形状，ahead/behind 标记也在用。

## 提交列表列宽：Author、Date 可拖，Message 填满

选：表头两条分界线。Message|Author 只改 Author；Author|Date 两列此消彼长、Message 不动。拖过存像素进 `viewState`；没拖过用 CSS 的 `8em` / `9.5em`（跟字号走）。拖动起点量表头实际宽度，所以 em 与像素之间无缝。
- 否决默认值也写成像素：丢掉跟字号缩放。
- 否决 Author|Date 只改 Date：拖它时 Author 整列跟着平移，手感不对。

## 撤销提交不单设入口，用 Reset → Soft

选：「撤销最近一次提交」「弹出最上面几条」都由 Reset → Soft 完成（右键要保留的那条）。
- 否决 `Undo Commits up to Here…`：与 Reset Soft 同一条 `git reset --soft`，只是换了要点的那条提交（D.6(d)）。
- 否决 IDEA 式 Undo Commit：独有价值只有把说明填回 Commit 面板；补漏文件用 Amend 即可，说明自动带出。

## 改写历史造成的与远程不一致：完全不管

选：reset / rebase 类改写不查提交是否已推送，确认框不提醒；推送被拒的提示不为改写场景调整，也不引导 force push。分叉是推送与 Update 本来就要面对的状态，用户自己处理。
- 否决确认框提醒「N 条已推送」、否决 IDEA 的受保护分支禁用改写、否决被拒时提供 force push（用户 2026-10-15 定）。

## 第 9 阶段缩小：要弹窗的功能等自定义弹出窗口

选：reword、squash、fixup、force push 移进池子；本阶段只做 reset（drop 也暂缓进池子，用户定）。fixup 归交互式 rebase（IDEA 包成编辑说明、合并提交、交互式 rebase 三个功能，都靠弹窗）。IDEA 用弹窗解决的交互，我们大概率也要用弹窗，现在用原生框凑合以后还得重做。
- 否决 squash 先自动拼接说明、不让编辑：说明是 squash 的一半，做一半以后还要改入口。
- 否决 force push 先放分支右键加原生确认：推送的各种变体统一进推送对话框。
- Reset 例外：原生模态框四个按钮够用，先做，以后搬进弹窗。

## 自定义弹出窗口：webview 标签页上的表单页

扩展做不出顶层的自定义模态窗口（VS Code 不给 API）。选：要放列表、选项、输入框的「对话框」一律开成 **webview 标签页**，按表单页排版（同 VS Code 自己的设置页、欢迎页）：
- 内容一列，最大宽度 600～720px、水平居中、从顶上排；窄于约 480px 时「标签 + 控件」改上下排。只有一种会变长的东西（比如提交列表），给最大高度、内部滚动；不做多栏。
- 三段固定：标题（含一行说明）／中间内容（超出时自己滚动）／贴底的按钮栏（按钮靠右，主按钮在最右）。
- **能共用就共用**（用户定）：一个通用外壳组件（标题、内容、按钮栏、宽度规则）加一套共用表单控件，各个对话框只往里填内容；同一份 webview 包，按视图挂根组件（tech/architecture.md 第 4 题）。
- **共用组件等用到的地方多了再抽**（用户定，2026-10-15）：只有一两处用到时先写在对话框里，需求还不明确，抽早了容易白做、架构变复杂；用到的地方多了、相似的控件开始各写一份时再抽成 `webview/src/ui/` 下的组件，免得改一处别处不一致。外壳 `DialogShell` 例外（形态已定，每个对话框都用）。
- **风格贴近 IDE 本身**（用户定）：控件用 vscode-elements，颜色、字号、间距用 VS Code 的主题变量，不自己定配色；深浅色与高对比主题不另做。
- 每种对话框只开一个标签（开着就切过去，按新的对象重新填）；点主按钮就关标签，操作在后台跑，结果走进度出口与错误关口（同 IDEA 的推送对话框；2026-10-15 改，原为「成功后自动关，失败留着显示错误」：对话框里再显示一遍错误，就是两个东西回答同一个问题）。不跟着仓库刷新，不绑 Esc（会与下拉框和键位插件冲突）。
- 先做推送对话框当原型，外壳与控件验证过再搬 reword、squash 等。
否决：
- 原生模态框：只能放文字和按钮，按钮顺序由平台定。
- QuickPick 多步向导（GitLens 的做法）：一次只看到一步，看不到全貌；做不了列表 + 开关 + 输入框的组合。
- 在 Log / Commit 面板内部画遮罩：只能盖住那个面板，面板小时很挤。
- 移到独立系统窗口（`moveEditorToNewWindow`）：位置与大小不受控，不是模态，多一个窗口要管。

## Reword 在内存里造提交（第 11 阶段，2026-10-15）

选：只改说明的改写，从那条到 HEAD 逐条 `commit-tree <原 tree> -p <新父提交>`，再 `reset --soft`。内容不变就不可能冲突，不碰工作区；代价是自己保留作者与作者时间、`commit.gpgSign` 时自己加 `-S`、不触发 commit-msg 钩子。HEAD 也走这一套。
- 否决 `rebase -i` 加两个脚本（tech/architecture.md 第 21 题原定）：检出、autostash、停下与继续都用不上。
- 否决 squash 先用 `Squash Commits up to Here…`（这条到 HEAD 合成一条）：等提交列表多选（用户定）。
- 否决改写后的 Undo 通知（IDEA 有，用户定，不进池子）。

## 日志（第 12 阶段，2026-10-16）

- 纪律写进 `CLAUDE.md` G（用户定：规则都放一起）；数字（截断上限、慢的阈值）只在 `ipc/brief.ts` 开头，`CLAUDE.md` 只指过去，不重复写数字。
- 分级按出没出问题，不按读写或频率（用户定）：`LogOutputChannel` 默认 info，debug 不显示也不落盘；stash 展开为空那次的问题就在读请求上。否决读写表、频率表。
- 只有一个新概念「操作」；否决按钮级来源、对话框父子关系、把刷新追到具体写操作（要改几十个调用点或只能靠猜）。
- 不脱敏，但所有数据过 `brief()` 精简（用户定）；单个标识不缩短（这次 stash 是从日志里的完整 hash 找回的）。

## 不做误删补救（2026-10-16 用户定）

- 永不做删除 / 改写后带 Restore、Undo 的通知，也不为防误删挪走 Stash 工具栏的 Delete。删除前有原生确认框；真删错了，日志里有完整 hash 可以找回（第 12 阶段）。
