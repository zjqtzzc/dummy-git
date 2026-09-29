/**
 * 跑一条 git 命令时要不要抢锁。
 *
 * 设计依据见 `.notes/specs/locking.md` §2.1。
 *
 * 只有两态。git4idea 有第三态 `READ_OPTIONAL_LOCKING`，那是为了支持 git < 2.15
 * （`GIT_OPTIONAL_LOCKS` 自 2.15 起）；我们无条件传该变量，第三态不需要。
 *
 * **`None` 是真的一把锁都不取**，连共享锁也不取——读命令本来就不碰 index，
 * 取共享锁只增复杂度、无任何保护。git4idea 实际也是这么做的
 * （`GitImplBase.java:459`：`lockingPolicy != READ && …`，READ 直接返回空令牌）。
 *
 * ## 这里曾经还有 `CommandKind` 与 `CommandMeta`，已砍（2026-09-18）
 *
 * `kind`（命令身份）的理由是「日志、调试」，但 `GitCli` 已经在记
 * `> git rev-parse --show-toplevel [12ms] ok`——完整命令行、耗时、结局。
 * `kind` 提供不了任何新信息。砍掉它连带消掉了那条「禁止用 enum 值拼 git 参数」
 * 的陷阱警告：**陷阱本身不存在了。**
 *
 * `kind` 一走，`CommandMeta` 只剩 `lock` 一个字段，结构体也就没有存在意义。
 */
export enum LockPolicy {
  None = "none",
  Exclusive = "exclusive",
}
