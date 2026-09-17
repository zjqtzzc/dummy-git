/**
 * 一条提交。`git log` 的解析结果，Log 面板的数据源。
 *
 * 设计依据见 `.notes/design/M3-parsers.md` §2.1。
 */

/**
 * 一次署名：谁、什么时候。
 *
 * git 的每条提交有两个署名——author（写代码的人）与 committer（把它放进历史的人）。
 * cherry-pick、rebase、`--amend` 之后两者会不同。
 */
export interface Signature {
  readonly name: string;
  /**
   * 可能是空串。git 不强制要求邮箱，界面上要处理「不显示空的 `<>`」。
   * 空串是合法值，不是「缺失」——所以是 `string` 而不是 `string | undefined`。
   */
  readonly email: string;
  /**
   * unix 秒。
   *
   * 不存 ISO 字符串：格式化是界面的事，而**数字没有「格式错误」这种状态**。
   * 旧仓库写 `authorDate: string // ISO 8601`，靠注释承担类型该承担的职责。
   */
  readonly at: number;
}

export interface Commit {
  readonly hash: string;
  /**
   * 父提交的 hash，**顺序有意义**：第一个是第一父提交。
   *
   * - 根提交是**空数组**，不是 `[""]`。`%P` 给的是空字符串，
   *   `"".split(" ")` 会得到 `[""]`——那会凭空造出一个 hash 为空串的假父提交，
   *   画图时表现为一条通向图外的线，不报任何错。
   * - merge 提交有两个或更多。
   * - 顺序不能打乱（不能用 Set、不能排序）：「只跟随第一父提交」这类视图依赖它。
   */
  readonly parents: readonly string[];
  readonly author: Signature;
  /**
   * 虽然界面目前只显示 author，committer 也一并提供。
   *
   * 理由是「数据层都提供，应用层决定怎么渲染」（见 `M3-parsers.md` §2.4）：
   * git 默认按**提交日期**倒序排，而列表显示的是**作者**——rebase 之后两者脱节，
   * Date 列会看起来乱序。到时候换哪个、怎么显示，是应用层的决定，数据层不替它做。
   */
  readonly committer: Signature;
  /**
   * `%B` 全文，含换行与结尾空白。
   *
   * 不拆成 subject / body：subject 就是「第一行」，纯派生。
   * 存两份就有不一致的可能，而切第一行只是一次 `indexOf("\n")`。
   */
  readonly message: string;
}

/**
 * 提交图的骨架：画出整张图所需的**全部**信息，一条都不多。
 *
 * 图算法只要三样：每条提交的 hash、它的父提交、以及排序用的时间。
 * 不需要作者，不需要消息——那些是选中某一行之后才要显示的东西。
 *
 * 为什么单独一个结构而不是复用 `Commit`：全量扫描要跑遍**整个历史**
 * （vscode 仓库 18.8 万条），窄字段的输出是 18 MB，带上作者和消息就是 46 MB。
 * 而画图用不到那 28 MB。
 *
 * 取数模型见 `.notes/design/M3-parsers.md` §4.2：
 * 全量拉骨架建图，用户看到哪几行就按 hash 去取那几条的 `Commit`。
 */
export interface CommitSkeleton {
  readonly hash: string;
  /** 与 `Commit.parents` 同义：根提交是空数组，顺序有意义。 */
  readonly parents: readonly string[];
  /**
   * 提交时间（`%ct`），unix 秒。
   *
   * 用提交时间不用作者时间：`--date-order` 的排序依据就是它，
   * 骨架的顺序必须和这个一致，否则图的行号和列表对不上。
   */
  readonly at: number;
}
