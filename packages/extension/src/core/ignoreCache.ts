import type { GitCli } from "../git/cli.js";
import { checkIgnore } from "../git/commands/index.js";

/**
 * 记住「工作区的哪些路径是被 git 忽略的」，让日志/构建产物的写入不再刷界面。
 *
 * 设计见 `.notes/design/M6-repository.md` §9.2；用户从旧仓库实际用出来的痛点，
 * 症状链见 `FEATURES.md` §7.2.1（进度条每隔几秒闪、文件树整个重绘）。
 *
 * ## 它不做模式匹配，只做记忆
 *
 * gitignore 的语义有否定规则、父目录规则、多级 `.gitignore`、`core.excludesFile`。
 * 自己实现必然某处与 git 不一致，而**危险方向的不一致**（把没忽略的当成忽略了）
 * 表现为「用户的改动不显示」。
 *
 * 所以答案始终来自 `git check-ignore`——**正确性不是「实现得准」，
 * 是「根本没有自己的实现」**。连「被 `add -f` 强制跟踪的 ignored 文件」
 * 这个 GitLens 踩过的洞，我们也不需要防护：git 的 check-ignore 默认认 index，
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
 * ## 代价被什么限死
 *
 * - 日志反复写**同一个路径** → 只有第一次放行，之后永久命中缓存 → 目标场景解决
 * - 构建产物每次换随机文件名 → 几百个新路径落在同一个防抖窗口里 → 每次构建
 *   一次刷新，不是每个文件一次
 *
 * 批量查询实测：大仓库（`~/Projects/vscode`）上 5 条路径约 10 ms。
 */

/** 缓存上限。构建产物用随机文件名时，不加限制会无限长。 */
const MAX_ENTRIES = 10_000;

export class IgnoreCache {
  /** 路径（相对仓库根，`/` 分隔）→ 是否被 git 忽略。 */
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

    const asking = [...this.pending];
    this.pending.clear();

    const ignored = await checkIgnore.execute(this.cli, this.repository, asking);

    // 两种答案都要记：记「是」才能挡住后续事件，
    // 记「否」才能避免对普通源码文件反复起子进程去问。
    for (const path of asking) {
      this.known.set(path, ignored.has(path));
    }

    this.evictIfNeeded();
  }

  /**
   * 清空。规则可能变了，之前的答案一律作废。
   *
   * 触发时机（`design/M6-repository.md` §9.2）：任意 `.gitignore` /
   * `.git/info/exclude` / `config`（`core.excludesFile` 可能变）/
   * `.git/index`（可能有 `add -f`，会让一个已忽略的路径变成不忽略）。
   *
   * 清空是廉价的：缓存按路径惰性重建，重建成本是每个防抖窗口一次批量查询。
   */
  invalidate(): void {
    this.known.clear();
    this.pending.clear();
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
