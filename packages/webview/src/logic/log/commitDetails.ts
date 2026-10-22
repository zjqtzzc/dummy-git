import type { Commit, Signature } from "@dummy-git/shared";
import { formatDateTime } from "../utils/time.js";

/**
 * Log 右栏下半部分显示的提交详情，排成几段，组件照着摆：
 *
 * ```
 * 标题（加粗）
 * 正文（照原样，保留换行）
 * 1a2b3c4  Alice <alice@x.com>  2026/9/20 15:51
 * committed by Bob <bob@x.com>  2026/9/21 09:00     ← 灰色，和作者不同时才有
 * ```
 */
export interface CommitDetailsView {
  /** 第一段（到第一个空行为止）。第一段本身有好几行时不算标题，是空串，整段说明都在正文里。 */
  readonly subject: string;
  /** 标题之后的部分，去掉首尾空行；没有就是空串。 */
  readonly body: string;
  readonly hash: string;
  /** `名字 <邮箱>  日期`。 */
  readonly author: string;
  /**
   * 提交者和作者不是同一个人：`committed by 名字 <邮箱>  日期`；
   * 同一个人、只是时间不同（rebase、amend 过）：`committed 日期`；都一样就缺席。
   */
  readonly committer?: string;
}

export function commitDetailsView(commit: Commit): CommitDetailsView {
  const message = commit.message.trim();
  const split = message.indexOf("\n\n");
  const first = split === -1 ? message : message.slice(0, split);
  const rest = split === -1 ? "" : message.slice(split).trim();
  const titled = !first.includes("\n");
  const { author, committer } = commit;
  const samePerson = author.name === committer.name && author.email === committer.email;
  const base = {
    subject: titled ? first : "",
    body: titled ? rest : message,
    hash: commit.hash.slice(0, 7),
    author: `${personText(author)}  ${formatDateTime(author.at)}`,
  };
  if (!samePerson) {
    return {
      ...base,
      committer: `committed by ${personText(committer)}  ${formatDateTime(committer.at)}`,
    };
  }
  if (committer.at !== author.at)
    return { ...base, committer: `committed ${formatDateTime(committer.at)}` };
  return base;
}

/** `名字 <邮箱>`；邮箱为空时只写名字，不写空的 `<>`。 */
export function personText(person: Signature): string {
  return person.email === "" ? person.name : `${person.name} <${person.email}>`;
}
