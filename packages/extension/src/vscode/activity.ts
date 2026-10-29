/**
 * 正在做的用户操作：进度出口（`progress.ts`）登记，状态栏看。
 *
 * 记的是 handler 声明的操作，不是队列里的命令：一次「更新当前分支」横跨远程道与本地道，
 * 在队列里是两条，对用户是一件事；读命令也不进队列。
 *
 * 存标题列表而不是计数：几个操作同时在跑时，状态栏的悬停提示要列出各自在做什么。
 * 同名的可以同时有两个（连点两次 Fetch），所以结束时只删一条。
 */
export class Activity {
  private readonly running: string[] = [];
  private readonly listeners = new Set<() => void>();

  get titles(): readonly string[] {
    return this.running;
  }

  async run<T>(title: string, task: () => Promise<T>): Promise<T> {
    this.running.push(title);
    this.emit();
    try {
      return await task();
    } finally {
      this.running.splice(this.running.indexOf(title), 1);
      this.emit();
    }
  }

  /** 返回退订函数。 */
  onDidChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
