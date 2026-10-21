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

- 流程见 `process/workflow.md`。为什么这么细地拆步：项目负责人的目标是理解每一行代码，理解优先于速度。
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

## 右键菜单：每个菜单项一个键，右键那一刻按整个选中算好（2026-10-19）

**写在哪**：行上不带 `data-vscode-context`。列表或树的容器收到 `contextmenu` 时，先改选中（点在已选中的行上不变，点在别的行上改成只选它），再算出这次的上下文，**直接改 DOM** 写到容器上（`webview/src/logic/menuContext.ts`）。右键事件先到容器、后到 VS Code 挂在最外层的监听，它读到的已经是新值（F5 调试窗口实测：交替右键两条提交，菜单与命令收到的参数都跟着变）。不经 Vue：Vue 稍后才写进 DOM，赶不赶得上取决于浏览器内部的时机。依据是 GitLens 的 webview 同样这么做。
- 否决每行带上整个选中：选中一变，每个可见的选中行都要重写一遍整串。否决点了菜单项再回头问页面：只解决得了点下去做什么，解决不了菜单里出现哪些项。
- 否决自己画菜单：能像 IDEA 一样弹菜单时直接读选中，但只能画在 webview 那块矩形里（Log 是底部面板，常放不下八九项），外观、键盘、点到 webview 外面时关菜单都要自己做。哪天原生菜单不够用了（比如要写置灰的原因）再回来定。
- 菜单键、Shift+F10 没测（Mac 上不好按）；现在点在空白处只拦掉默认菜单，不弹我们的项。

**每个菜单项一个键**，键就是它的命令 id：键在，这一项就出现（`when` 只写 `webviewId == … && <命令 id>`，`menu.test.ts` 守着）；值是这条命令的协议参数（不含 `repo`），扩展的菜单命令都一样：取出自己那一格、补上 `repo`、过同一张参数校验表、交给 handler。竖按钮、工具栏按钮用同一份定义。同 IDEA：每个菜单项的 `update()` 和 `actionPerformed()` 读同一份选中、用同一段判断。实测 `when` 里只写键名，值是列表、字符串都当作「有」。
- 一个菜单项写四样（`webview/src/logic/menuItems.ts` 的 `menuItem`）：看法、单个判断（从这一个里取出要用的东西，取不出就是不能做）、整体条件（可选：「正好一个」「至少两个且相邻」，只能单选和只能多选是同一回事；需要时也能看点中的节点本身，比如远程名不给 Delete）、值。定义带着参数的类型，竖按钮、工具栏按钮直接调它（`evaluate`），不从菜单上下文里捞没有类型的值。
- **全部严格**（项目负责人定）：每一个都能做、整体条件满足才出现，点了就全做，不跳过任何东西。代价：目录里只要有一个做不了的，整组就没有这一项（右键 `Local` 没有 Delete，因为里面有当前分支）。
- **两种看法**：展开看——选中的叶子加上选中目录下面列出的全部，去掉重复（同 IDEA `VcsTreeModelData.selected`）；原样看——点中的节点本身（同 `exactlySelected`）。目录只是归类时用展开看（分支目录、Commit 面板的目录：只动列出来的，不碰目录里没列出的），目录本身就是对象时用原样看（远程名的 Fetch、目录的历史）。
- 否决「名单 + 节点类型 + 开关键」：每一项真正要动的是名单的一部分，挑这一部分的规则页面要写一份（决定出不出现），扩展又要写一份（决定动谁）；`when` 也是没人测的字符串。否决「直接选的严格、目录带进来的只取能做的」：要给每一项带上「怎么进来的」标记，规则多一层，参照里也没有人这么做。

## Log、Commit 面板收起时保留页面（2026-10-21）

两个面板都开 `retainContextWhenHidden`。不开时每次展开都重建 iframe，先黑屏几百毫秒再一下子出来，小仓库也一样；打点实测黑屏在 iframe 开始加载之前、在 VS Code 里，我们自己只占 110～160 ms（`tech/performance.md` §5.1）。
- 代价：收起时页面常驻内存（Log 里有最多一万条的骨架和图）。隐藏期间 VS Code 不把消息送给页面，「哪些域过期了」的广播在扩展里攒着、重新可见时一次发出（`ipc/hiddenBuffer.ts`，同 GitLens 的 `eventVisibilityBuffer.ts`）；只攒域、去重，页面照常按域决定重拉什么。
- 否决「先画出页面框架、数据后到」：省掉的是取数据那 100 ms 左右，黑屏在它之前。
- 页面仍可能重建（窗口刚打开、VS Code 回收了隐藏的页面），握手的换代逻辑照旧。

## 需求只有一份：`product/` 下的路线图、需求池、永不做

永不做只放明确定了的、每条写理由；只是暂时不做的放需求池的「暂缓」（2026-10-16 项目负责人指出：以前不少「暂时不做」被写成了永不做）。

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

## D.6(a) 放宽：消费者已排进当前阶段实现顺序的，可以先加

第 8 阶段第 1 步加 `missingParents`（第 7 步截断处用）时定（2026-10-14）。理由：开发流程完整，一个模块的字段一次给全，免得后面回头改同一个文件。
界限是「写得出第几步」：当前阶段 `phases/phase-NN.md` 的实现顺序里有它的消费者；以后阶段的、需求池里的仍不算。
否决：维持只认已存在的消费者——实现顺序已经定好、用户确认过，「等它存在」只是把同一处改动拆成两次。

## F5 调试仓库：独立仓库 + 场景，不用 worktree

调试窗口打开的仓库由 `scripts/debug/setup.mjs` 按场景从零建（机制见 `process/manual-testing.md`）。
否决过本项目的 linked worktree：detached HEAD 只隔离了提交，`refs/heads`、`refs/stash`、配置整库共享——
调试窗口里删分支、drop stash 动真实仓库；`main` 已在主 worktree 检出，切不过去；进行中的 rebase 重置不掉。
否决过复用 `fixture.mjs` 的固定身份与时间：手测要贴近日常，「User: Me」「最近 24 小时」在固定值下匹配不到。
否决过 F5 弹 `pickString` 选场景：名单要在 `launch.json` 再抄一份，且同一轮手测每次 F5 都要多点一下。

## 不做误删补救（2026-10-16 用户定）

- 永不做删除 / 改写后带 Restore、Undo 的通知，也不为防误删挪走 Stash 工具栏的 Delete。删除前有原生确认框；真删错了，日志里有完整 hash 可以找回（第 12 阶段）。
