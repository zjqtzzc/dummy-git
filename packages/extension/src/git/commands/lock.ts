/**
 * 一条 git 命令进哪条道（`core/operation.ts`）。每仓库两条道，各自串行、互不等待。
 *
 * - `None`：读命令，不进任何道。读命令本来就不碰 index，取共享锁只增复杂度、无任何保护。
 *   `status` 能归这里，靠的是 `GIT_OPTIONAL_LOCKS=0`（不回写 index）。
 * - `Exclusive`：本地道。改暂存区、工作区、本地引用的命令（commit、merge、restore…）。
 * - `Remote`：远程道。网络命令（fetch、push）。它们也写引用（远程分支记录，`fetch M:B` 还写本地分支），
 *   并发会撞引用锁；放进同一条道就只是排队。不进本地道：慢推送期间照样能提交。
 *
 * 这里只管正确性（命令能不能同时跑），不管「正在做」的界面反馈——那是用户操作层的事。
 */
export enum LockPolicy {
  None = "none",
  Exclusive = "exclusive",
  Remote = "remote",
}
