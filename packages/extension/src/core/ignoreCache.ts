import type { GitCli } from "../git/cli.js";
import { checkIgnore } from "../git/commands/index.js";

/**
 * 记住「工作区的哪些路径是被 git 忽略的」，让日志/构建产物的写入不再刷界面。
 *
 * 否则被忽略的日志、构建产物不停写入时，进度条每隔几秒闪、文件树整个重绘。
 *
 * ## 它不做模式匹配，只做记忆
 *
 * gitignore 的语义有否定规则、父目录规则、多级 `.gitignore`、`core.excludesFile`。
 * 自己实现必然某处与 git 不一致，而**危险方向的不一致**（把没忽略的当成忽略了）
 * 表现为「用户的改动不显示」。
 *
 * 所以答案始终来自 `git check-ignore`——**正确性不是「实现得准」，
 * 是「根本没有自己的实现」**。连「被 `add -f` 强制跟踪的 ignored 文件」
 * 这个坑也不需要防护：git 的 check-ignore 默认认 index，
 * 被跟踪的文件它直接答「不忽略」，进不了缓存。
 *
 * ## 不认识的路径一律放行
 *
 * 第一次见到某个路径时我们还没有答案。**放行**（多刷一次），
 * 同时把它排进待问队列，下次批量问 git。
 *
 * 方向是刻意的：放行的代价是多一次刷新，误挡的代价是用户的改动不显示。
 * 两者不对称，所以宁可多放。
 *
 * ## 被忽略的目录整个记住
 *
 * 编译会在几分钟里源源不断地往 `build/` 写**新文件名**。只按路径记的话，
 * 每个防抖窗口都有没见过的路径，每个窗口都放行一次——等于整个编译期间一直在刷。
 *
 * 所以问 git 时把上级目录一起问（`build/`、`build/obj/`），被忽略的目录记下来，
 * 之后它下面的任何路径都直接挡住，不放行、不再问。
 *
 * 这不会挡掉被跟踪的文件：目录下只要有被跟踪的文件（`add -f`），
 * git 就不说这个目录被忽略（2.25、2.43 实测）。剩下的缺口是「目录记住之后才 `add -f`」：
 * `add` 本身写 index 会刷新，之后再改那个文件不触发刷新，要等别的刷新带出来。

## 规则变了，旧答案不更新

改了 `.gitignore` / `info/exclude` 之后，记下的答案照旧用到重载窗口。
「本来忽略、现在不忽略了」的文件，改动要等别的刷新带出来；反方向只是多刷几次。
 *
 * 目录一律带结尾的 `/` 问：目录已被删掉时，不带 `/` 的 `build` 会被当成文件，
 * `build/` 这类只匹配目录的规则就不命中了。
 *
 * ## 代价被什么限死
 *
 * - 日志反复写**同一个路径** → 只有第一次放行，之后永久命中缓存
 * - 往被忽略的目录里写新文件名 → 只有目录第一次被问到之前放行，之后永久命中
 * - 靠文件规则（`*.o`）忽略、又和源码混在一起的新文件名 → 仍然每个窗口放行一次
 *
 * 批量查询实测：大仓库（`~/Projects/vscode`）上 5 条路径约 10 ms。
 */

/** 缓存上限。构建产物用随机文件名时，不加限制会无限长。 */
const MAX_ENTRIES = 10_000;

/** `a/b/c.o` → `a/`、`a/b/`，由浅到深。 */
function ancestorDirectories(relPath: string): string[] {
  const directories: string[] = [];
  for (let i = relPath.indexOf("/"); i !== -1; i = relPath.indexOf("/", i + 1)) {
    directories.push(relPath.slice(0, i + 1));
  }
  return directories;
}

export class IgnoreCache {
  /**
   * 路径（相对仓库根，`/` 分隔）→ 是否被 git 忽略。
   * 目录以 `/` 结尾（`build/`），与同名文件不冲突。
   */
  private readonly known = new Map<string, boolean>();

  /** 还没问过 git 的路径。由 `resolvePending()` 批量消费。 */
  private readonly pending = new Set<string>();

  constructor(
    private readonly cli: GitCli,
    private readonly repository: string,
  ) {}

  /**
   * 这个路径该不该丢弃。**同步、零成本**——事件路径上每个文件都会调它。
   *
   * 不认识时返回 `false`（放行）并记下来，等 `resolvePending()` 去问。
   */
  shouldIgnore(relPath: string): boolean {
    for (const directory of ancestorDirectories(relPath)) {
      if (this.known.get(directory) === true) return true;
    }
    const known = this.known.get(relPath);
    if (known !== undefined) return known;
    this.pending.add(relPath);
    return false;
  }

  /** 有没有待问的。调用方据此决定要不要起那一次子进程。 */
  hasPending(): boolean {
    return this.pending.size > 0;
  }

  /**
   * 把攒下的路径**一次**问给 git，把答案写进缓存。
   *
   * 由防抖窗口触发——攒一批再问，而不是每个事件问一次，
   * 这是「每次构建一次刷新」而不是「每个文件一次」的由来。
   */
  async resolvePending(): Promise<void> {
    if (this.pending.size === 0) return;

    // 上级目录一起问，被忽略的目录记下来后，它下面的新文件名不用再问（见文件头）。
    const asking = new Set<string>();
    for (const path of this.pending) {
      asking.add(path);
      for (const directory of ancestorDirectories(path)) {
        if (!this.known.has(directory)) asking.add(directory);
      }
    }
    this.pending.clear();

    const ignored = await checkIgnore.execute(this.cli, this.repository, [...asking]);

    // 两种答案都要记：记「是」才能挡住后续事件，
    // 记「否」才能避免对普通源码文件反复起子进程去问。
    for (const path of asking) {
      this.known.set(path, ignored.has(path));
    }

    this.evictIfNeeded();
  }

  /** 供测试与诊断观察内部状态，不参与判定。 */
  get size(): number {
    return this.known.size;
  }

  /**
   * 超上限时整个清掉，不做 LRU。
   *
   * 选择理由：会把缓存撑到上万条的场景（构建产物用随机文件名）里，
   * 旧条目本来就再也不会被命中，LRU 的淘汰质量并不比全清更好，
   * 而全清少一份要维护的顺序结构。代价是清空后那一个防抖窗口会多刷一次。
   */
  private evictIfNeeded(): void {
    if (this.known.size > MAX_ENTRIES) {
      this.known.clear();
    }
  }
}
