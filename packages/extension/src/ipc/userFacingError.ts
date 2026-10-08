/**
 * 已知的失败，换成一句用户看得懂的话（ARCHITECTURE.md 第 15 题）。
 *
 * handler 认出已知结果（比如不能快进）后抛它；错误关口通知里显示 `message`，
 * 输出面板写 `message` 加 `detail`（git 原文）。关口只显示，不认识任何具体功能。
 */
export class UserFacingError extends Error {
  constructor(
    message: string,
    /** git 原文，写进输出面板供排查；没有就缺席。 */
    readonly detail?: string,
  ) {
    super(message);
    this.name = "UserFacingError";
  }
}
