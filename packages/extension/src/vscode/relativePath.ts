import type { RepositoryLocation } from "../git/commands/index.js";

/**
 * 把一个绝对路径转成相对于某个基准目录的路径，分隔符统一为 `/`。
 *
 * 这是**外部感知链路的入口**：VSCode 的文件事件给的是绝对 URI，
 * 而 M6 的域分类表（`core/watchPatterns.ts`、`core/classify.ts`）按 `/` 分隔的
 * 相对路径书写。这一步转换错了，watcher 收到的每个事件都会被丢弃，
 * 表现是**外部 git 操作完全感知不到，且不报任何错**。
 *
 * ## 为什么不用 `path.relative()`
 *
 * `node:path` 在 Linux 上是 posix 实现，它不认识 `\` 是分隔符——
 * 拿 `C:\repo\.git\HEAD` 进去会被当成一个文件名里含反斜杠的怪东西。
 * 于是「Windows 上对不对」这件事在 Linux 上**测不了**，
 * 而这正是原来那个 bug 能潜伏下来的原因。
 *
 * 本函数只做字符串处理，**与运行平台无关**，所以 Linux 上也能验 Windows 的行为。
 *
 * ## 原来错在哪（2026-09-21 修）
 *
 * ```ts
 * const prefix = `${base.fsPath}/`;                    // ← 拼了 `/`
 * if (!uri.fsPath.startsWith(prefix)) return undefined;
 * return uri.fsPath.slice(prefix.length).replaceAll("\\", "/");   // ← 只归一了结果
 * ```
 *
 * **归一化只做在返回值上，没做在比较上。** Windows 下 `fsPath` 是
 * `C:\repo\.git\HEAD`，而 prefix 是 `C:\repo\.git/`——`startsWith` 永不匹配。
 * 紧挨着的那行注释写明了「Windows 上 fsPath 是 `\`」，代码却没照做：
 * **注释不是守卫，它不会失败。**
 *
 * 正解是**先归一两边，再比较**。
 */
export function relativeTo(basePath: string, targetPath: string): string | undefined {
  const base = basePath.replaceAll("\\", "/");
  const target = targetPath.replaceAll("\\", "/");
  const prefix = base.endsWith("/") ? base : `${base}/`;
  if (!target.startsWith(prefix)) return undefined;
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
