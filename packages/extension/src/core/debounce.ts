/**
 * 把短时间内涌入的若干项聚合成一次回调。
 *
 * ## 语义：trailing debounce + maxWait
 *
 * - 事件持续涌入时计时器不断推迟，**流停下来 `waitMs` 之后**才触发一次——
 *   一次 `commit` 产生的事件簇（实测跨度 3.3 ms）因此只换来一次回调。
 * - 但持续不断的事件流不能把回调饿死，所以从本轮**第一项**算起，
 *   最多憋 `maxWaitMs` 就必须触发。
 *
 * ## 为什么是 150 / 1000，而不是抄两家的 1000
 *
 * vscode（`repository.ts:3198`）与旧仓库（`gitWatcher.ts:8`）都用 1000 ms。
 * **但那两个 1000 成立的前提是我们砍掉的东西**：两家自己的写操作都绕过 watcher
 * 直接刷新，1 秒窗口只影响「感知外部变化」，用户感觉不到。
 * 我们没有那条旁路（`design/M6-repository.md` §7），照抄 1000 会变成
 * 每次 Commit 后一秒的呆滞。
 *
 * 150 的依据是实测（`NFR.md` §7）：一次 `commit` 的事件簇跨度 **3.3 ms**，
 * 150 是它的 45 倍，余量充足；而 150 落在人的「即时」感知阈值（约 200 ms）以内，
 * 所以 §7 那个「写操作完成信号」要解决的问题**不存在**，不是被省略了。
 *
 * maxWait 取 1000 而非旧仓库的 5000：rebase 会一步步产生事件持续数秒，
 * 5 秒意味着 Banner 上的 `(3/7)` 五秒才跳一次，太钝。
 *
 * ## 为什么是「集合」而不是单个值
 *
 * 一个窗口里会涌入多个不同的域（一次 commit 同时命中 refs 与 worktree）。
 * 聚合的语义是**并集**，不是最后一个。
 */
export class DebouncedSet<T> {
  private pending = new Set<T>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** 本轮第一项加入的时刻；0 表示当前没有待处理项。 */
  private firstAddedAt = 0;

  constructor(
    private readonly onFlush: (items: ReadonlySet<T>) => void,
    private readonly waitMs: number,
    private readonly maxWaitMs: number,
  ) {}

  /** 加入若干项。传空集合时什么都不做，**不会**启动计时。 */
  add(items: Iterable<T>): void {
    let added = false;
    for (const item of items) {
      this.pending.add(item);
      added = true;
    }
    if (!added) return;

    if (this.firstAddedAt === 0) this.firstAddedAt = Date.now();
    this.schedule();
  }

  /**
   * 立刻触发一次（如果有待处理项）。
   *
   * 留这个口子是为了**测试能确定性地推进**，以及将来 §7.5 若要加
   * 「写操作完成后提前结算」时有现成的入口——那条现在不做，
   * 但加法是一行，不需要改结构。
   */
  flushNow(): void {
    this.clearTimer();
    if (this.pending.size === 0) return;
    const items = this.pending;
    this.pending = new Set();
    this.firstAddedAt = 0;
    this.onFlush(items);
  }

  /** 丢弃待处理项，不触发回调。用于 dispose。 */
  cancel(): void {
    this.clearTimer();
    this.pending.clear();
    this.firstAddedAt = 0;
  }

  get pendingSize(): number {
    return this.pending.size;
  }

  private schedule(): void {
    this.clearTimer();
    // 正常等 waitMs，但不能越过本轮的 maxWaitMs 上限。
    const remaining = this.maxWaitMs - (Date.now() - this.firstAddedAt);
    const delay = Math.max(0, Math.min(this.waitMs, remaining));
    this.timer = setTimeout(() => this.flushNow(), delay);
  }

  private clearTimer(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}

/** 窗口值。单独导出，让「为什么是这两个数」只有一处出处（见文件头）。 */
export const DEBOUNCE_MS = 150;
export const MAX_WAIT_MS = 1000;
