import * as vscode from "vscode";
import type { Repository } from "../core/repository.js";
import { DOT_GIT_GLOB } from "../core/watchPatterns.js";

/**
 * 文件变化 → `Repository`。闭环的最后一段。
 *
 * ## 两个 watcher，不是一个
 *
 * `.git/**` 与工作区是两类完全不同的东西，分域也不一样
 * （`.git/HEAD` 变了是 `refs`，工作区文件变了只是 `worktree`），
 * 所以分开订阅、分别喂给 `Repository` 的两个入口。
 *
 * ## 白名单在**订阅时**给，不是收到之后再过滤
 *
 * `.git/objects/**` 一次 fetch 能刷出上千个事件。给了白名单（`DOT_GIT_GLOB`），
 * 这些事件**根本不会到达**——连收都不用收。
 * 收下来再 `if` 掉是在我们这边花 CPU 处理一堆注定要丢的东西。
 * 来源：GitLens 的 `watcherPatterns.ts`（M6 第 7 步）。
 *
 * 白名单与 `classify` 的噪声规则是**两道独立关卡，少一个都不行**：
 * `refs/heads/main.lock` 能穿过白名单（`refs/**` 必须放行 refs 下一切），
 * 靠噪声规则挡；`index.lock` 则被白名单挡住（白名单里是精确的 `index`）。
 *
 * ## 为什么这一层这么薄
 *
 * 分类、ignore 过滤、防抖全在 M6 里，且都能在纯 node 下测。
 * 这里只负责「把 VSCode 的事件翻译成相对路径」——**唯一真正需要宿主的那部分**。
 */
export function watchRepository(repository: Repository): vscode.Disposable {
  const root = vscode.Uri.file(repository.root);

  const dotGit = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(vscode.Uri.joinPath(root, ".git"), DOT_GIT_GLOB),
  );
  const worktree = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, "**"));

  const relativeTo = (base: vscode.Uri, uri: vscode.Uri): string | undefined => {
    const prefix = `${base.fsPath}/`;
    if (!uri.fsPath.startsWith(prefix)) return undefined;
    // 统一成 `/` 分隔：M6 的分类表按 `/` 写，Windows 上 fsPath 是 `\`。
    return uri.fsPath.slice(prefix.length).replaceAll("\\", "/");
  };

  const dotGitPath = vscode.Uri.joinPath(root, ".git");
  const feedGit = (uri: vscode.Uri): void => {
    const rel = relativeTo(dotGitPath, uri);
    if (rel !== undefined) repository.notifyGitPath(rel);
  };
  const feedWorktree = (uri: vscode.Uri): void => {
    const rel = relativeTo(root, uri);
    // `.git` 下的事情由上面那个 watcher 管，别喂两遍。
    if (rel !== undefined && !rel.startsWith(".git/")) repository.notifyWorkspacePath(rel);
  };

  const subscriptions = [
    dotGit,
    worktree,
    dotGit.onDidCreate(feedGit),
    dotGit.onDidChange(feedGit),
    dotGit.onDidDelete(feedGit),
    worktree.onDidCreate(feedWorktree),
    worktree.onDidChange(feedWorktree),
    worktree.onDidDelete(feedWorktree),
  ];

  return vscode.Disposable.from(...subscriptions);
}
