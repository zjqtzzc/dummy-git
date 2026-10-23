/**
 * 推送时一起推哪些 tag。不推是不带这个值。
 *
 * 放在 shared：推送对话框选它，扩展照着推。
 */
export enum PushTagMode {
  /** 本地全部 tag。 */
  All = "all",
  /** 这次推的提交够得着、远程还没有的附注 tag；轻量 tag 不推。 */
  Follow = "follow",
}
