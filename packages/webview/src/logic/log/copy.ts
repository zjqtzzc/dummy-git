import { assertNever, type Commit, RefKind } from "@dummy-git/shared";
import { formatDateTime } from "../utils/time.js";
import { type BranchNode, BranchNodeKind } from "./branchTree.js";
import { personText } from "./commitDetails.js";

/**
 * 提交列表上 Ctrl+C 复制的文字：完整说明，空一行，作者与日期各一行。
 * 邮箱为空时只写名字。日期写绝对时间。
 */
export function commitCopyText(commit: Commit): string {
  const author = personText(commit.author);
  return `${commit.message.trimEnd()}\n\nAuthor: ${author}\nDate: ${formatDateTime(commit.author.at)}`;
}

/**
 * 分支树上 Ctrl+C 复制的名字：本地分支是全名，远程分支是 `origin/feat`，
 * HEAD 那行是当前分支名、detached 时是完整 hash。目录与分组没有，返回 `undefined`。
 */
export function branchCopyText(node: BranchNode): string | undefined {
  switch (node.kind) {
    case BranchNodeKind.Head:
      return node.branch ?? node.target;
    case BranchNodeKind.Branch:
      return node.ref.kind === RefKind.LocalBranch
        ? node.ref.name
        : `${node.ref.remote}/${node.ref.name}`;
    case BranchNodeKind.Group:
    case BranchNodeKind.Folder:
      return undefined;
    default:
      return assertNever(node, "branchCopyText");
  }
}
