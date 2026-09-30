/**
 * 跑一条 git 命令时要不要抢锁。
 *
 * 设计依据见 `.notes/specs/locking.md` §2.1。
 *
 * 只有两态。「读、但可能顺手写 index」的第三态只在 git < 2.15 时需要
 * （`GIT_OPTIONAL_LOCKS` 自 2.15 起）；我们无条件传该变量，第三态不需要。
 *
 * **`None` 是真的一把锁都不取**，连共享锁也不取——读命令本来就不碰 index，
 * 取共享锁只增复杂度、无任何保护。
 */
export enum LockPolicy {
  None = "none",
  Exclusive = "exclusive",
}
