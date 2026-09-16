# `core/` —— 状态机与操作队列

规划内容：`operation.ts`（M5）/ `repository.ts` `domains.ts` `watcher.ts`（M6）。

这一层是旧仓库**完全缺失**的：它的 `views/*Provider` 直接调 `gitService`，
所有状态协调逻辑散在 `extension.ts` 的 89 个 handler 里。
