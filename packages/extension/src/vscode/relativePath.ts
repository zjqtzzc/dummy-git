import type { RepositoryLocation } from "../git/commands/index.js";

/**
 * 把一个绝对路径转成相对于某个基准目录的路径，分隔符统一为 `/`。
 *
 * 这是**外部感知链路的入口**：VSCode 的文件事件给的是绝对 URI，
 * 而域分类表（`core/watchPatterns.ts`、`core/classify.ts`）按 `/` 分隔的
 * 相对路径书写。这一步转换错了，watcher 收到的每个事件都会被丢弃，
 * 表现是**外部 git 操作完全感知不到，且不报任何错**。
 *
 * ## 为什么不用 `path.relative()`
 *
 * `node:path` 在 Linux 上是 posix 实现，它不认识 `\` 是分隔符——
 * 拿 `C:\repo\.git\HEAD` 进去会被当成一个文件名里含反斜杠的怪东西。
 * 用它的话，「Windows 上对不对」这件事在 Linux 上**测不了**。
 *
 * 本函数只做字符串处理，**与运行平台无关**，所以 Linux 上也能验 Windows 的行为。
 *
 * ## 先归一两边，再比较
 *
 * Windows 下 `fsPath` 是 `C:\repo\.git\HEAD`。只归一返回值、拿 `${base}/` 去 `startsWith` 的话，
 * prefix 是 `C:\repo\.git/`，永不匹配——每个事件都被丢掉。
 */
export function relativeTo(basePath: string, targetPath: string): string | undefined {
  const base = basePath.replaceAll("\\", "/");
  const target = targetPath.replaceAll("\\", "/");
  const prefix = base.endsWith("/") ? base : `${base}/`;
  // 盘符路径大小写不敏感：VS Code 的 fsPath 可能是 `C:\Repo`，工作区根是 `c:\repo`。
  // 对不上则事件丢掉、外部 git 不刷新。POSIX 仍区分大小写。只折盘符形式，Linux 上也能测。
  const comparable = (path: string): string =>
    /^[A-Za-z]:/.test(path) ? path.toLowerCase() : path;
  if (!comparable(target).startsWith(comparable(prefix))) return undefined;
  return target.slice(prefix.length);
}

/**
 * 工作区里的一个文件事件 → 喂给 `notifyWorkspacePath` 的相对路径；不该喂的返回 `undefined`。
 *
 * git 目录里的事件由 git 目录的 watcher 管，这里跳过，别喂两遍。
 * 判断「在不在 git 目录里」用仓库位置，**不写死 `.git/`**：普通仓库的 git 目录恰好在根下，
 * linked worktree 的在别处——两种情况同一条规则。
 */
export function workspaceRelative(
  location: RepositoryLocation,
  fsPath: string,
): string | undefined {
  if (relativeTo(location.gitDir, fsPath) !== undefined) return undefined;
  if (relativeTo(location.commonDir, fsPath) !== undefined) return undefined;
  return relativeTo(location.root, fsPath);
}
