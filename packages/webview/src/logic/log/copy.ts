import { assertNever, type Commit, RefKind } from "@dummy-git/shared";
import { formatDateTime } from "../utils/time.js";
import { type BranchNode, BranchNodeKind } from "./branchTree.js";

/**
 * 提交列表上 Ctrl+C 复制的文字，同 IDEA：一条一行，说明的第一行、作者名字、日期，用空格隔开；
 * 多条按列表顺序一行一条。日期写绝对时间：贴出去的文字不该写「5 minutes ago」。
 */
export function commitCopyText(commits: readonly Commit[]): string {
  return commits
    .map((commit) => {
      const end = commit.message.indexOf("\n");
      const subject = end === -1 ? commit.message : commit.message.slice(0, end);
      return `${subject} ${commit.author.name} ${formatDateTime(commit.author.at)}`;
    })
    .join("\n");
}

/**
 * 分支树上 Ctrl+C 时一行复制什么：本地分支是全名，远程分支是 `origin/feat`，
 * HEAD 那行是当前分支名、detached 时是完整 hash（树上显示的只是最后一段，贴出去用不了）。
 * 目录与分组返回 `undefined`：复制它显示的文字。
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
    case BranchNodeKind.Remote:
      return undefined;
    default:
      return assertNever(node, "branchCopyText");
  }
}
