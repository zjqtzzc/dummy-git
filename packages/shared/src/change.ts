/**
 * 工作区里一个有改动的文件。`git status --porcelain=v2 -z -uall` 的解析结果。
 *
 * 服务 Commit 面板与 M6 的状态机。
 */

export enum ChangeKind {
  Tracked = "tracked",
  Untracked = "untracked",
  Conflict = "conflict",
}

/**
 * 单个位置（暂存区或工作区）上的改动类型。
 *
 * **值是 `"modified"` 而不是 `"M"`。** 写成 `Modified = "M"` 就等于把 git 的输出格式
 * 焊进了我们的类型定义：git 的 porcelain v1 与 v2 状态字符不同，换格式时前者要改
 * 类型定义和所有用到它的地方，后者只改一张映射表。
 *
 * git-graph 正是反面例子（`types.ts:76`）：它的 `Untracked = "U"` 与 git 自己的
 * `U`（unmerged，即冲突）撞车，加上 `<GitFileStatus>output[i][0]` 的类型断言，
 * 冲突文件会被静默归类成「未跟踪」。
 */
export enum FileStatus {
  Unchanged = "unchanged",
  Modified = "modified",
  Added = "added",
  Deleted = "deleted",
  Renamed = "renamed",
  Copied = "copied",
  TypeChanged = "typeChanged",
}

/**
 * 七种未合并状态。
 *
 * 命名按 git 的语义直译，但要注意它们的**真实含义不是字面意思**：
 * `AddedByUs` 不是「我们新建了个文件」，而是「这个路径只存在于未解决冲突的我方」；
 * `BothDeleted` 不是「两边都主动删了」，而是「原路径在两边都消失了」。
 *
 * 一次改名冲突（两边把同一文件改成不同名字）会同时产出三条记录：
 * 原路径 `BothDeleted` + 我方新名字 `AddedByUs` + 对方新名字 `AddedByThem`。
 */
export enum ConflictKind {
  BothModified = "bothModified",
  BothAdded = "bothAdded",
  BothDeleted = "bothDeleted",
  AddedByUs = "addedByUs",
  AddedByThem = "addedByThem",
  DeletedByUs = "deletedByUs",
  DeletedByThem = "deletedByThem",
}

/**
 * 三种改动，分开是为了让不可能的状态写不出来。
 *
 * - **冲突单独一支**：平时 `XY` 两个字符是两个独立维度（X=暂存区、Y=工作区），
 *   冲突时它们变成「我方/对方」的一对，是不可分割的整体。塞进同一个结构就会出
 *   vscode 那种事故——`AA` 在 X 和 Y 两个 switch 里各命中一次，同一文件出现两条记录。
 * - **未跟踪单独一支**：未跟踪文件在 index 里根本没有条目。分开之后，
 *   「一个未跟踪文件同时有已暂存的修改」这种不可能的状态在类型上就写不出来。
 *
 * 注意 `index` 与 `worktree` 两个状态都保留，尽管 IDEA 风格的 Commit 面板
 * 不显示暂存区概念、一个文件只出现一条。**合并显示是界面的决定，不是数据的决定**——
 * 数据丢了找不回来，界面合并随时可以改。
 */
export type FileChange =
  | {
      readonly kind: ChangeKind.Tracked;
      readonly path: string;
      /** 仅 `Renamed` / `Copied` 时存在，是改名前的路径。 */
      readonly oldPath?: string;
      /** 暂存区相对 HEAD 的改动。 */
      readonly index: FileStatus;
      /** 工作区相对暂存区的改动。 */
      readonly worktree: FileStatus;
    }
  | {
      readonly kind: ChangeKind.Untracked;
      readonly path: string;
    }
  | {
      readonly kind: ChangeKind.Conflict;
      readonly path: string;
      readonly conflict: ConflictKind;
    };

/**
 * 一次 `git status` 的结果：HEAD 在哪条提交上，加上工作区的改动。
 *
 * HEAD 与改动来自同一次调用，两者一定对得上。Commit 面板打开 diff 时左边要 HEAD 的完整 hash
 * （历史版本的 URI 必须是完整 hash，内容才永远不变）。
 */
export interface StatusSnapshot {
  /** HEAD 的完整 hash。还没有任何提交的仓库没有 HEAD，缺席。 */
  readonly head?: string;
  readonly changes: FileChange[];
}

/**
 * **一条提交里**改动的一个文件。`git log --name-status` 的解析结果。
 *
 * ## 为什么不复用上面的 `FileChange`
 *
 * `FileChange` 是为 `git status` 建的，它的核心是 `index` / `worktree` **两个维度**——
 * 「暂存区相对 HEAD」与「工作区相对暂存区」。
 *
 * 一条已经存在的提交没有这两个维度：文件相对父提交只有**一个**状态。
 * 复用 `FileChange` 就得给那两个字段编造值（比如都填 `Modified`，或一个填
 * `Unchanged`），而编造出来的值会被下游当真。
 *
 * 这正是旧仓库那类问题的来源——**为了省一个类型，把两件不同的事塞进同一个形状**。
 * 多定义一个接口的成本是十行；混用的成本是每个消费者都要知道「这里的 worktree
 * 字段是假的」，而没有任何地方写着这句话。
 *
 * 复用的是 `FileStatus`（枚举本身），因为「改了/加了/删了/改名了」确实是同一组概念。
 */
export interface CommitFileChange {
  readonly path: string;
  /** 仅 `Renamed` / `Copied` 时存在，是改名前的路径。 */
  readonly oldPath?: string;
  /** 相对父提交的改动。merge 提交默认不输出文件列表，见 name-status 解析器。 */
  readonly status: FileStatus;
}
