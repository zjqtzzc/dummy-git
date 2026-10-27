import { GitDomain, GitErrorCode } from "@dummy-git/shared";
import type { GitCli } from "../git/cli.js";
import type { GitCommand, RepositoryLocation } from "../git/commands/index.js";
import { GitFailureError } from "../git/failure.js";
import { classifyGitPath } from "./classify.js";
import { DEBOUNCE_MS, DebouncedSet, MAX_WAIT_MS } from "./debounce.js";
import { runCommand } from "./executor.js";
import { IgnoreCache } from "./ignoreCache.js";
import { CommandQueue } from "./operation.js";

/**
 * 一个仓库的状态权威，也是界面层碰 git 的唯一入口。
 *
 * ## 它回答的问题：「现在是什么状态」
 *
 * 下面几层造的都是**动作**（跑命令、解析、认错、排队），问完就完，没人记得答案。
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
 * 「加一条新 git 命令」变成「要改 Repository」。
 */
export enum RepositoryState {
  Active = "active",
  /** 仓库没了（被删、被移动、盘符掉了）。此后不再起任何 git 进程。 */
  Disposed = "disposed",
}

export class Repository {
  private _state = RepositoryState.Active;

  /**
   * 队列**私有持有、不对外暴露**：一仓库一队列。
   *
   * `runCommand(queue, cli, cmd, ...args)` 里 `queue` 与 args 中的仓库路径毫无关联——
   * 传一个全局队列进去代码照跑，只是所有仓库开始互相等待。
   * 队列在构造时内部创建，没有任何方法能取到它，**想传错都没有地方传**。
   */
  private readonly queue = new CommandQueue();

  private readonly ignoreCache: IgnoreCache;

  /** 域变化的订阅者。用 Set 而不是数组：退订是按身份删，不是按下标。 */
  private readonly listeners = new Set<(domains: ReadonlySet<GitDomain>) => void>();

  private readonly pending: DebouncedSet<GitDomain>;

  constructor(
    /**
     * 仓库在磁盘上的位置，由 `getRepositoryLocation` 命令产出。
     * `location.root` 同时是这个仓库的标识。凡要碰仓库目录的代码都从这里取路径。
     */
    readonly location: RepositoryLocation,
    private readonly cli: GitCli,
  ) {
    this.ignoreCache = new IgnoreCache(cli, location.root);
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
   * 「写操作完成」信号唯一能买到的是去掉防抖等待，而 150 ms 的窗口
   * 本来就在感知阈值以内；外部终端的操作反正要靠 watcher，两条路会回答同一个问题。
   */
  async run<A extends readonly unknown[], R>(command: GitCommand<A, R>, ...args: A): Promise<R> {
    if (this._state === RepositoryState.Disposed) {
      // 不起进程。批量操作时队列里可能排着几十条，一条条起了再失败是白费。
      throw new Error(`仓库已失效，不再执行命令：${this.location.root}`);
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
   * 大仓库上是秒级、几百 MB，而此刻可能根本没人在看那个面板。
   * 让消费者自己决定要不要拉，是唯一不浪费的做法。
   *
   * 返回退订函数：**订阅者的生命周期比仓库短**。`Repository` 跟着 workspace 走，
   * 面板来来去去，每开一个面板就有一个 `Router` 订阅这里，面板关了必须退订，
   * 否则监听器只增不减，已经关掉的面板还在收广播。
   */
  onDidChange(listener: (domains: ReadonlySet<GitDomain>) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 喂一个 `.git` 目录内的相对路径（`/` 分隔）。
   *
   * 由 `vscode/` 层的文件监听调用。这一层不订阅任何东西——
   * 那样它才能在纯 node 下测。
   */
  notifyGitPath(relPath: string): void {
    if (this._state === RepositoryState.Disposed) return;
    this.pending.add(classifyGitPath(relPath));
  }

  /**
   * 喂一个工作区路径（相对仓库根，`/` 分隔）。
   *
   * **先过 ignore 的筛**：被 `.gitignore` 忽略的日志/构建产物持续写入时，
   * 不挡住的话界面会一直抖。
   *
   * 不认识的路径一律放行（多刷一次，安全方向），同时排队等下次批量问 git。
   */
  notifyWorkspacePath(relPath: string): void {
    if (this._state === RepositoryState.Disposed) return;
    if (this.ignoreCache.shouldIgnore(relPath)) return;
    // 工作区的一切只映射到 worktree。
    this.pending.add([GitDomain.Worktree]);
  }

  /** 供测试确定性推进：立刻结算待处理的域，不等防抖窗口。 */
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
   * 仓库没了（`NotAGitRepository`）就停止一切，而不是反复对一个不存在的
   * 仓库起进程、反复报错。
   */
  private disposeIfRepositoryGone(error: unknown): void {
    if (error instanceof GitFailureError && error.code === GitErrorCode.NotAGitRepository) {
      this.dispose();
    }
  }

  private emit(domains: ReadonlySet<GitDomain>): void {
    // 先解析 ignore 的待问项，让下一轮能命中缓存。不走 run()：emit 不能排队等写锁。
    // 失败不影响本次通知。仓库没了要 dispose，否则下一轮还对已死仓库起 check-ignore。
    if (this.ignoreCache.hasPending()) {
      void this.ignoreCache.resolvePending().catch((error) => {
        this.disposeIfRepositoryGone(error);
      });
    }
    for (const listener of this.listeners) listener(domains);
  }
}
