import * as vscode from "vscode";
import type { Repository } from "../core/repository.js";
import { watchTargets } from "../core/watchPatterns.js";
import { relativeTo, workspaceRelative } from "./relativePath.js";

/**
 * 文件变化 → `Repository`。闭环的最后一段。
 *
 * ## git 目录与工作区分开监听
 *
 * git 目录与工作区是两类完全不同的东西，分域也不一样
 * （`HEAD` 变了是 `refs`，工作区文件变了只是 `worktree`），
 * 所以分开订阅、分别喂给 `Repository` 的两个入口。
 * git 目录要监听哪几处、各用什么白名单，由 `watchTargets(location)` 决定——
 * 普通仓库一处，linked worktree 两处。路径一律取自仓库位置，不拼 `<根>/.git`。
 *
 * ## 白名单在**订阅时**给，不是收到之后再过滤
 *
 * `.git/objects/**` 一次 fetch 能刷出上千个事件。给了白名单（`core/watchPatterns.ts`），
 * 这些事件**根本不会到达**——连收都不用收。
 * 收下来再 `if` 掉是在我们这边花 CPU 处理一堆注定要丢的东西。
 *
 * 白名单与 `classify` 的噪声规则是**两道独立关卡，少一个都不行**：
 * `refs/heads/main.lock` 能穿过白名单（`refs/**` 必须放行 refs 下一切），
 * 靠噪声规则挡；`index.lock` 则被白名单挡住（白名单里是精确的 `index`）。
 *
 * ## 为什么这一层这么薄
 *
 * 分类、ignore 过滤、防抖全在 `core/` 里，且都能在纯 node 下测。
 * 这里只负责「把 VSCode 的事件翻译成相对路径」——**唯一真正需要宿主的那部分**。
 */
export function watchRepository(repository: Repository): vscode.Disposable {
  const { location } = repository;
  const subscriptions: vscode.Disposable[] = [];

  // git 目录：普通仓库一处，linked worktree 两处（`watchTargets` 决定）。
  for (const target of watchTargets(location)) {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(target.directory), target.glob),
    );
    const feed = (uri: vscode.Uri): void => {
      const rel = relativeTo(target.directory, uri.fsPath);
      if (rel !== undefined) repository.notifyGitPath(rel);
    };
    subscriptions.push(
      watcher,
      watcher.onDidCreate(feed),
      watcher.onDidChange(feed),
      watcher.onDidDelete(feed),
    );
  }

  const worktree = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(vscode.Uri.file(location.root), "**"),
  );
  const feedWorktree = (uri: vscode.Uri): void => {
    const rel = workspaceRelative(location, uri.fsPath);
    if (rel !== undefined) repository.notifyWorkspacePath(rel);
  };
  subscriptions.push(
    worktree,
    worktree.onDidCreate(feedWorktree),
    worktree.onDidChange(feedWorktree),
    worktree.onDidDelete(feedWorktree),
  );

  return vscode.Disposable.from(...subscriptions);
}
