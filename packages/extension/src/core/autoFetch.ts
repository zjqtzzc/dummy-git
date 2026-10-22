/**
 * 自动 Fetch：仓库打开后先跑一次，之后每次跑完再等 `AUTO_FETCH_INTERVAL_MS` 跑下一次。
 * 同 IDEA 勾上「Fetch remote changes automatically」时（`GitBranchIncomingOutgoingManager`：启用时先跑一次，
 * 之后固定间隔 20 分钟，`scheduleWithFixedDelay`）。上一次没跑完不会叠着跑。
 *
 * 默认开、间隔写死在这里：项目还没有设置项，以后和别的设置一起放进去。
 * 跑什么、失败怎么办由调用方给：失败只记日志，不弹窗、不进状态栏。
 */

/** 两次自动 Fetch 之间隔多久。 */
export const AUTO_FETCH_INTERVAL_MS = 20 * 60 * 1000;

export function startAutoFetch(
  fetch: () => Promise<unknown>,
  onError: (cause: unknown) => void,
  intervalMs: number = AUTO_FETCH_INTERVAL_MS,
): { dispose(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const tick = async (): Promise<void> => {
    try {
      await fetch();
    } catch (cause) {
      onError(cause);
    }
    if (!stopped) timer = setTimeout(() => void tick(), intervalMs);
  };
  void tick();

  return {
    dispose: () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}
