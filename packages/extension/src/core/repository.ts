import { GitDomain, GitErrorCode } from "@dummy-git/shared";
import type { GitCli } from "../git/cli.js";
import type { GitCommand } from "../git/commands/command.js";
import { GitFailureError } from "../git/failure.js";
import { classifyGitPath } from "./classify.js";
import { DEBOUNCE_MS, DebouncedSet, MAX_WAIT_MS } from "./debounce.js";
import { runCommand } from "./executor.js";
import { IgnoreCache } from "./ignoreCache.js";
import { CommandQueue } from "./operation.js";

/**
 * 一个仓库的状态权威。**M6 的产出，也是 M7 唯一的入口。**
 *
 * 设计见 `.notes/design/M6-repository.md`。
 *
 * ## 它回答的问题：「现在是什么状态」
 *
 * M2–M5 造的都是**动作**（跑命令、解析、认错、排队），问完就完，没人记得答案。
 * 状态和动作的根本差别是：**状态会自己过期**——用户在外面的终端敲了
 * `git commit`，我们什么都没做，手里的答案已经错了。
 * 所以这一层的真正任务不是「存一份状态」，而是**知道它什么时候不再有效**。
 *
 * ## 对外只有三样东西
 *
 * `run()` / `onDidChange()` / `state`。
 *
 * **刻意没有 `getStatus()` / `getBranches()` 这类方法**——那些是命令，
 * 通过 `run(getStatus, …)` 调。替每条命令包一个同名方法会让
 * 「加一条新 git 命令」变成「要改 Repository」，正是 M5 极力避免的耦合。
 */
export enum RepositoryState {
  Active = "active",
  /** 仓库没了（被删、被移动、盘符掉了）。此后不再起任何 git 进程。 */
  Disposed = "disposed",
}

export class Repository {
  private _state = RepositoryState.Active;

  /**
   * 队列**私有持有、不对外暴露**。
   *
   * 这是 M5 复核时点名的结构性缺口（见 `REVIEW-LOG.md`）：当时「一仓库一队列」
   * 靠的是 demo 自己建了两个队列，`runCommand(queue, cli, cmd, ...args)` 里
   * `queue` 与 args 中的仓库路径毫无关联——传一个全局队列进去代码照跑，
   * 只是所有仓库开始互相等待。
   *
   * 现在队列在构造时内部创建，没有任何方法能取到它，**想传错都没有地方传**。
   */
  private readonly queue = new CommandQueue();

  private readonly ignoreCache: IgnoreCache;

  /** 域变化的订阅者。用 Set 而不是数组：退订是按身份删，不是按下标。 */
  private readonly listeners = new Set<(domains: ReadonlySet<GitDomain>) => void>();

  private readonly pending: DebouncedSet<GitDomain>;

  constructor(
    /** 仓库根目录，由 `getRepositoryRoot` 命令产出。同时是这个仓库的标识。 */
    readonly root: string,
    private readonly cli: GitCli,
  ) {
    this.ignoreCache = new IgnoreCache(cli, root);
    this.pending = new DebouncedSet<GitDomain>(
      (domains) => this.emit(domains),
      DEBOUNCE_MS,
      MAX_WAIT_MS,
    );
  }

  get state(): RepositoryState {
    return this._state;
  }

  /**
   * 跑一条 git 命令。**唯一的执行入口。**
   *
   * 成功之后**不做任何通知**——刷新完全由 watcher 驱动。
   * 这不只是 M5 砍掉 `mutates` 的后果，也是 §7 独立复核后的结论：
   * 「写操作完成」信号唯一能买到的是去掉防抖等待，而 150 ms 的窗口
   * 本来就在感知阈值以内，它要解决的问题不存在。
   */
  async run<A extends readonly unknown[], R>(command: GitCommand<A, R>, ...args: A): Promise<R> {
    if (this._state === RepositoryState.Disposed) {
      // 不起进程。批量操作时队列里可能排着几十条，一条条起了再失败是白费。
      throw new Error(`仓库已失效，不再执行命令：${this.root}`);
    }

    try {
      return await runCommand(this.queue, this.cli, command, ...args);
    } catch (error) {
      this.disposeIfRepositoryGone(error);
      throw error;
    }
  }

  /**
   * 订阅「哪几类数据过期了」。
   *
   * 事件**只说过期，不带新值**——算出新值要跑 `git log` + `for-each-ref`，
   * 在 vscode 仓库上是 1.9 秒、360 MB（`NFR.md` §5.3），而此刻可能根本
   * 没人在看那个面板。让消费者自己决定要不要拉，是唯一不浪费的做法。
   *
   * **不返回退订函数。** 曾返回过一个 `Unsubscribe`，但没有任何调用点接住它，
   * 也没有任何测试覆盖它——按 `CLAUDE.md` D.5.1(b)，把返回值改成 `void`
   * 不会让任何测试失败，所以它不该存在。
   * `dispose()` 负责整体销毁；单个监听器退订等 M7 的 router 真正需要时再加，
   * 那时才知道它该长什么样（一个 router 持有多个订阅，形态与现在的猜测未必一致）。
   */
  onDidChange(listener: (domains: ReadonlySet<GitDomain>) => void): void {
    this.listeners.add(listener);
  }

  /**
   * 喂一个 `.git` 目录内的相对路径（`/` 分隔）。
   *
   * 由 `vscode/` 层的文件监听调用（M7）。这一层不订阅任何东西——
   * 那样它才能在纯 node 下跑给人看。
   */
  notifyGitPath(relPath: string): void {
    if (this._state === RepositoryState.Disposed) return;
    this.pending.add(classifyGitPath(relPath));
  }

  /**
   * 喂一个工作区路径（相对仓库根，`/` 分隔）。
   *
   * **先过 ignore 的筛**：被 `.gitignore` 忽略的日志/构建产物持续写入时，
   * 不挡住的话界面会一直抖（`FEATURES.md` §7.2.1 的真实痛点）。
   *
   * 不认识的路径一律放行（多刷一次，安全方向），同时排队等下次批量问 git。
   */
  notifyWorkspacePath(relPath: string): void {
    if (this._state === RepositoryState.Disposed) return;
    if (this.ignoreCache.shouldIgnore(relPath)) return;
    // 工作区的一切只映射到 worktree（`design/M6-repository.md` §9.1）。
    // 加入 ideaShelf 域时这里要改成分类表，那是垂直切片期的事。
    this.pending.add([GitDomain.Worktree]);
  }

  /** 供测试与 M7 确定性推进：立刻结算待处理的域，不等防抖窗口。 */
  flushPending(): void {
    this.pending.flushNow();
  }

  /** 释放。之后 `run()` 拒绝执行，事件不再发出。 */
  dispose(): void {
    this._state = RepositoryState.Disposed;
    this.pending.cancel();
    this.listeners.clear();
  }

  /**
   * M4 欠下的**唯一消费者**在这里兑现（`design/M6-repository.md` §2.1）。
   *
   * `GitErrorCode.NotAGitRepository` 从 M4 产出至今没有任何人读过。
   * 它的意义就是这一处：仓库没了就停止一切，而不是反复对一个不存在的
   * 仓库起进程、反复报错。vscode 的 `repository.ts:2734` 做的是同一件事。
   */
  private disposeIfRepositoryGone(error: unknown): void {
    if (error instanceof GitFailureError && error.code === GitErrorCode.NotAGitRepository) {
      this.dispose();
    }
  }

  private emit(domains: ReadonlySet<GitDomain>): void {
    // 先解析 ignore 的待问项，让下一轮能命中缓存。
    // 失败不影响本次通知——最坏情况是下一轮再放行一次。
    if (this.ignoreCache.hasPending()) {
      void this.ignoreCache.resolvePending().catch(() => undefined);
    }
    for (const listener of this.listeners) listener(domains);
  }
}
