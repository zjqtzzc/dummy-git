/**
 * `postMessage` 边界的运行时校验。**全项目第二个、也是最后一个校验点**
 * （`CLAUDE.md` C.1；第一个是 `git stdout → parser`）。
 *
 * ## 为什么非验不可
 *
 * 类型标注编译后就没了。`window.addEventListener("message", e => …)` 里的
 * `e.data` 在运行时就是 `unknown`——把它标成 `RequestMessage` 是**一句谎话**，
 * 不会有任何东西去核实。
 *
 * 真实的出错来源不是攻击（webview 里跑的是我们自己打包的代码），是**版本错位**：
 * 扩展更新了、面板还开着上一版的页面。这时消息形状对不上，
 * 而没有校验的话表现是 `undefined` 一路流进 `spawn` 的参数数组，
 * 报一句 `spawn EINVAL`——与真正的原因隔着十万八千里。
 *
 * 验过之后**边界之内一律信任类型，不写防御性检查**（C.2）。
 *
 * ## 为什么文件名是 `.guards.ts`
 *
 * `scripts/check-assertions.mjs` 对 `*.guards.ts` 豁免类型断言禁令。
 * 那条豁免存在的理由就是「边界解析与类型守卫」——这里是它的第二个使用场景。
 * 不过下面实际上一个断言都没用到：全部靠类型谓词收窄，`as` 一次都不需要。
 */

import {
  type CommandName,
  type CommandParams,
  DialogKind,
  DiffOpenMode,
  type DiffSide,
  DiffSideKind,
  type Generation,
  type InboundMessage,
  type MatchCondition,
  MatchKind,
  MessageKind,
} from "@dummy-git/shared";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asGeneration(value: unknown): Generation | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * diff 的一边。深验：`hash` 与 `path` 会拼进 `git cat-file` 的命令行。
 * hash 的格式（完整 40 / 64 位）在 URI 解析时再卡一次，这里只管类型与闭集。
 */
function asDiffSide(value: unknown): DiffSide | undefined {
  if (!isRecord(value)) return undefined;
  const path = value["path"];
  if (typeof path !== "string") return undefined;
  switch (value["kind"]) {
    case DiffSideKind.Revision: {
      const hash = value["hash"];
      return typeof hash === "string" ? { kind: DiffSideKind.Revision, hash, path } : undefined;
    }
    case DiffSideKind.Missing:
      return { kind: DiffSideKind.Missing, path };
    case DiffSideKind.WorkingTree:
      return { kind: DiffSideKind.WorkingTree, path };
    // 暂存区的一栏只由扩展构造（合并编辑器），页面不发。
    case DiffSideKind.Stage:
      return undefined;
    default:
      return undefined;
  }
}

function asDialogKind(value: unknown): DialogKind | undefined {
  switch (value) {
    case DialogKind.Push:
      return DialogKind.Push;
    default:
      return undefined;
  }
}

function asDiffOpenMode(value: unknown): DiffOpenMode | undefined {
  switch (value) {
    case DiffOpenMode.Open:
      return DiffOpenMode.Open;
    case DiffOpenMode.Follow:
      return DiffOpenMode.Follow;
    default:
      return undefined;
  }
}

function asStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.every((item) => typeof item === "string") ? value : undefined;
}

/**
 * 会进 git 命令行的引用。只认 `refs/` 开头：`-` 开头的值会被当成选项。
 */
function asRef(value: unknown): string | undefined {
  return typeof value === "string" && value.startsWith("refs/") ? value : undefined;
}

/**
 * 一条提交的完整 hash。40 位是 SHA-1，64 位是 SHA-256。短 hash 可能对上别的提交，不收。
 * 十六进制不会被 git 当成选项。
 */
function asCommit(value: unknown): string | undefined {
  return typeof value === "string" && /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i.test(value)
    ? value
    : undefined;
}

/** 仓库、起点、显示名。起点由调用方决定认引用还是也认 hash。 */
function asNamedStart(
  raw: Record<string, unknown>,
  start: string | undefined,
): { repo: string; start: string; startName: string } | undefined {
  const repo = raw["repo"];
  const startName = raw["startName"];
  return typeof repo === "string" &&
    start !== undefined &&
    typeof startName === "string" &&
    startName !== ""
    ? { repo, start, startName }
    : undefined;
}

function asRefTarget(
  raw: Record<string, unknown>,
): { repo: string; start: string; startName: string } | undefined {
  return asNamedStart(raw, asRef(raw["start"]));
}

/** 变基的起点：分支的完整引用，或一条提交的完整 hash。 */
function asRebaseTarget(
  raw: Record<string, unknown>,
): { repo: string; start: string; startName: string } | undefined {
  return asNamedStart(raw, asRef(raw["start"]) ?? asCommit(raw["start"]));
}

/** 摘一条提交、做反向提交：仓库和完整 hash。 */
function asCommitTarget(raw: Record<string, unknown>): { repo: string; hash: string } | undefined {
  const repo = raw["repo"];
  const hash = asCommit(raw["hash"]);
  return typeof repo === "string" && hash !== undefined ? { repo, hash } : undefined;
}

/**
 * 每条命令怎么把 `unknown` 变成它的参数类型。
 *
 * **与 `Commands` 是两张表，但回答的是两个不同的问题**：`Commands` 说
 * 「参数的类型是什么」，这里说「一个运行时的值是不是那个类型」。
 * TypeScript 无法从类型推出校验器（类型不在运行时存在），所以这份重复是必要的，
 * 不是 `CLAUDE.md` D.6(d) 说的「同一个问题被回答两次」。
 *
 * `satisfies` 保证这张表**每条命令都有**，漏一条编译不过——
 * 与 `defineHandlers` 同一个思路：完整性由编译器管，不靠记性。
 */
const PARAM_GUARDS = {
  // 没有参数。仍然要有一条守卫——表必须是完整的，`satisfies` 才拦得住漏写。
  getRepositories: () => ({}),
  getSkeleton: (raw: Record<string, unknown>) => {
    const repo = raw["repo"];
    const branch = raw["branch"];
    if (typeof repo !== "string") return undefined;
    if (branch === undefined) return { repo };
    // 会进 git 的命令行：只认完整引用名，`-` 开头的值不能被当成选项。
    return typeof branch === "string" && branch.startsWith("refs/") ? { repo, branch } : undefined;
  },
  getCommitDetails: (raw: Record<string, unknown>) => {
    const repo = raw["repo"];
    const hashes = asStringArray(raw["hashes"]);
    return typeof repo === "string" && hashes !== undefined ? { repo, hashes } : undefined;
  },
  getRefs: (raw: Record<string, unknown>) => {
    const repo = raw["repo"];
    return typeof repo === "string" ? { repo } : undefined;
  },
  openDiff: (raw: Record<string, unknown>) => {
    const repo = raw["repo"];
    const left = asDiffSide(raw["left"]);
    const right = asDiffSide(raw["right"]);
    const mode = asDiffOpenMode(raw["mode"]);
    return typeof repo === "string" &&
      left !== undefined &&
      right !== undefined &&
      mode !== undefined
      ? { repo, left, right, mode }
      : undefined;
  },
  getCommitFiles: (raw: Record<string, unknown>) => {
    const repo = raw["repo"];
    const hash = raw["hash"];
    return typeof repo === "string" && typeof hash === "string" ? { repo, hash } : undefined;
  },
  getStashes: (raw: Record<string, unknown>) => {
    const repo = raw["repo"];
    return typeof repo === "string" ? { repo } : undefined;
  },
  applyStash: (raw: Record<string, unknown>) => {
    const repo = raw["repo"];
    const hash = raw["hash"];
    return typeof repo === "string" && typeof hash === "string" ? { repo, hash } : undefined;
  },
  popStash: (raw: Record<string, unknown>) => {
    const repo = raw["repo"];
    const hash = raw["hash"];
    return typeof repo === "string" && typeof hash === "string" ? { repo, hash } : undefined;
  },
  dropStash: (raw: Record<string, unknown>) => {
    const repo = raw["repo"];
    const hash = raw["hash"];
    return typeof repo === "string" && typeof hash === "string" ? { repo, hash } : undefined;
  },
  matchCommits: (raw: Record<string, unknown>) => {
    const repo = raw["repo"];
    const hashes = asStringArray(raw["hashes"]);
    const condition = parseMatchCondition(raw["condition"]);
    return typeof repo === "string" && hashes !== undefined && condition !== undefined
      ? { repo, hashes, condition }
      : undefined;
  },
  pickPath: (raw: Record<string, unknown>) => {
    const repo = raw["repo"];
    return typeof repo === "string" ? { repo } : undefined;
  },
  pickAuthor: (raw: Record<string, unknown>) => {
    const repo = raw["repo"];
    const hashes = asStringArray(raw["hashes"]);
    return typeof repo === "string" && hashes !== undefined ? { repo, hashes } : undefined;
  },
  resetTo: (raw: Record<string, unknown>) => {
    const repo = raw["repo"];
    const hash = raw["hash"];
    return typeof repo === "string" && typeof hash === "string" ? { repo, hash } : undefined;
  },
  markResolved: (raw: Record<string, unknown>) => {
    const repo = raw["repo"];
    const path = raw["path"];
    return typeof repo === "string" && typeof path === "string" ? { repo, path } : undefined;
  },
  removeConflictFile: (raw: Record<string, unknown>) => {
    const repo = raw["repo"];
    const path = raw["path"];
    return typeof repo === "string" && typeof path === "string" ? { repo, path } : undefined;
  },
  resolveDeletion: (raw: Record<string, unknown>) => {
    const repo = raw["repo"];
    const path = raw["path"];
    return typeof repo === "string" && typeof path === "string" ? { repo, path } : undefined;
  },
  addUntracked: (raw: Record<string, unknown>) => {
    const repo = raw["repo"];
    const path = raw["path"];
    return typeof repo === "string" && typeof path === "string" ? { repo, path } : undefined;
  },
  deleteUntracked: (raw: Record<string, unknown>) => {
    const repo = raw["repo"];
    const path = raw["path"];
    return typeof repo === "string" && typeof path === "string" ? { repo, path } : undefined;
  },
  openMergeEditor: (raw: Record<string, unknown>) => {
    const repo = raw["repo"];
    const path = raw["path"];
    return typeof repo === "string" && typeof path === "string" ? { repo, path } : undefined;
  },
  openPushDialog: (raw: Record<string, unknown>) => {
    const repo = raw["repo"];
    const branch = raw["branch"];
    return typeof repo === "string" && typeof branch === "string" ? { repo, branch } : undefined;
  },
  closeDialog: (raw: Record<string, unknown>) => {
    const dialog = asDialogKind(raw["dialog"]);
    return dialog === undefined ? undefined : { dialog };
  },
  copyText: (raw: Record<string, unknown>) => {
    const text = raw["text"];
    return typeof text === "string" ? { text } : undefined;
  },
  pick: (raw: Record<string, unknown>) => {
    const title = raw["title"];
    const items = asStringArray(raw["items"]);
    return typeof title === "string" && items !== undefined ? { title, items } : undefined;
  },
  getStatus: (raw: Record<string, unknown>) => {
    const repo = raw["repo"];
    return typeof repo === "string" ? { repo } : undefined;
  },
  getOperation: (raw: Record<string, unknown>) => {
    const repo = raw["repo"];
    return typeof repo === "string" ? { repo } : undefined;
  },
  continueOperation: (raw: Record<string, unknown>) => {
    const repo = raw["repo"];
    const message = raw["message"];
    return typeof repo === "string" && typeof message === "string" ? { repo, message } : undefined;
  },
  abortOperation: (raw: Record<string, unknown>) => {
    const repo = raw["repo"];
    return typeof repo === "string" ? { repo } : undefined;
  },
  commit: (raw: Record<string, unknown>) => {
    const repo = raw["repo"];
    const message = raw["message"];
    const paths = asStringArray(raw["paths"]);
    // 空列表会让 `commit --only` 提交整个暂存区：在这里拒绝。
    return typeof repo === "string" &&
      typeof message === "string" &&
      paths !== undefined &&
      paths.length > 0
      ? { repo, message, paths }
      : undefined;
  },
  checkout: (raw: Record<string, unknown>) => {
    const repo = raw["repo"];
    const branch = raw["branch"];
    return typeof repo === "string" && typeof branch === "string" ? { repo, branch } : undefined;
  },
  checkoutRemote: (raw: Record<string, unknown>) => {
    const repo = raw["repo"];
    const remote = raw["remote"];
    const branch = raw["branch"];
    return typeof repo === "string" && typeof remote === "string" && typeof branch === "string"
      ? { repo, remote, branch }
      : undefined;
  },
  newBranch: (raw: Record<string, unknown>) => {
    const repo = raw["repo"];
    const start = raw["start"];
    const startName = raw["startName"];
    return typeof repo === "string" && typeof start === "string" && typeof startName === "string"
      ? { repo, start, startName }
      : undefined;
  },
  renameBranch: (raw: Record<string, unknown>) => {
    const repo = raw["repo"];
    const branch = raw["branch"];
    return typeof repo === "string" && typeof branch === "string" ? { repo, branch } : undefined;
  },
  deleteBranch: (raw: Record<string, unknown>) => {
    const repo = raw["repo"];
    const branch = raw["branch"];
    return typeof repo === "string" && typeof branch === "string" ? { repo, branch } : undefined;
  },
  deleteRemoteBranch: (raw: Record<string, unknown>) => {
    const repo = raw["repo"];
    const remote = raw["remote"];
    const branch = raw["branch"];
    return typeof repo === "string" && typeof remote === "string" && typeof branch === "string"
      ? { repo, remote, branch }
      : undefined;
  },
  getPushTarget: (raw: Record<string, unknown>) => {
    const repo = raw["repo"];
    const branch = raw["branch"];
    return typeof repo === "string" && typeof branch === "string" ? { repo, branch } : undefined;
  },
  push: (raw: Record<string, unknown>) => {
    const repo = raw["repo"];
    const branch = raw["branch"];
    const remote = raw["remote"];
    const remoteBranch = raw["remoteBranch"];
    return typeof repo === "string" &&
      typeof branch === "string" &&
      typeof remote === "string" &&
      typeof remoteBranch === "string"
      ? { repo, branch, remote, remoteBranch }
      : undefined;
  },
  update: (raw: Record<string, unknown>) => {
    const repo = raw["repo"];
    const branch = raw["branch"];
    return typeof repo === "string" && typeof branch === "string" ? { repo, branch } : undefined;
  },
  merge: asRefTarget,
  rebase: asRebaseTarget,
  cherryPick: asCommitTarget,
  revert: asCommitTarget,
  fetch: (raw: Record<string, unknown>) => {
    const repo = raw["repo"];
    return typeof repo === "string" ? { repo } : undefined;
  },
  rollback: (raw: Record<string, unknown>) => {
    const repo = raw["repo"];
    const paths = asStringArray(raw["paths"]);
    return typeof repo === "string" && paths !== undefined && paths.length > 0
      ? { repo, paths }
      : undefined;
  },
  stash: (raw: Record<string, unknown>) => {
    const repo = raw["repo"];
    const paths = asStringArray(raw["paths"]);
    return typeof repo === "string" && paths !== undefined ? { repo, paths } : undefined;
  },
  amend: (raw: Record<string, unknown>) => {
    const repo = raw["repo"];
    const message = raw["message"];
    const paths = asStringArray(raw["paths"]);
    return typeof repo === "string" && typeof message === "string" && paths !== undefined
      ? { repo, message, paths }
      : undefined;
  },
} satisfies { [K in CommandName]: (raw: Record<string, unknown>) => CommandParams<K> | undefined };

/** 命令名是不是协议表里的。**这是「不存在游离命令」在运行时的那一半。** */
export function isCommandName(value: unknown): value is CommandName {
  return typeof value === "string" && Object.hasOwn(PARAM_GUARDS, value);
}

/** 按命令名校验参数。命令名已经收窄过，所以这里能精确到具体那条命令的形状。 */
export function parseParams<K extends CommandName>(
  command: K,
  raw: unknown,
): CommandParams<K> | undefined {
  if (!isRecord(raw)) return undefined;
  return PARAM_GUARDS[command](raw);
}

export enum InboundKind {
  /** 合法的消息。 */
  Message = "message",
  /** 读得出代号与 id，但命令名或参数不合法。 */
  Rejected = "rejected",
}

export type Inbound =
  | { readonly kind: InboundKind.Message; readonly message: InboundMessage }
  | {
      readonly kind: InboundKind.Rejected;
      readonly generation: Generation;
      readonly id: number;
      readonly reason: string;
    };

/**
 * 校验整个信封。
 *
 * - 返回 `undefined`：连代号或 id 都读不出，**回不了**，只能丢弃并记日志。
 * - `Rejected`：代号与 id 都在，只是命令名或参数不对（比如 webview 与扩展宿主版本不一致：
 *   webview 已是新构建、扩展宿主还没重新加载）。**能回就必须回一个错误**——
 *   「每条请求恰好回一次」是不设超时的前提，丢掉它前端就永远等下去。
 */
export function parseInbound(raw: unknown): Inbound | undefined {
  if (!isRecord(raw)) return undefined;

  const generation = asGeneration(raw["generation"]);
  if (generation === undefined) return undefined;

  if (raw["kind"] === MessageKind.Ready) {
    return { kind: InboundKind.Message, message: { kind: MessageKind.Ready, generation } };
  }

  if (raw["kind"] === MessageKind.Request) {
    const id = raw["id"];
    if (typeof id !== "number" || !Number.isInteger(id)) return undefined;
    const command = raw["command"];
    if (!isCommandName(command)) {
      return {
        kind: InboundKind.Rejected,
        generation,
        id,
        reason: `unknown command ${JSON.stringify(command)}`,
      };
    }

    const params = parseParams(command, raw["params"]);
    if (params === undefined) {
      return {
        kind: InboundKind.Rejected,
        generation,
        id,
        reason: `invalid params for ${command}`,
      };
    }

    return {
      kind: InboundKind.Message,
      message: { kind: MessageKind.Request, generation, id, command, params },
    };
  }

  return undefined;
}

/** Log 过滤的条件：带 `kind` 的联合，按 `kind` 校验各自的字段。 */
function parseMatchCondition(raw: unknown): MatchCondition | undefined {
  if (!isRecord(raw)) return undefined;
  switch (raw["kind"]) {
    case MatchKind.Text: {
      const text = raw["text"];
      return typeof text === "string" ? { kind: MatchKind.Text, text } : undefined;
    }
    case MatchKind.Author: {
      const name = raw["name"];
      const email = raw["email"];
      return typeof name === "string" && typeof email === "string"
        ? { kind: MatchKind.Author, name, email }
        : undefined;
    }
    case MatchKind.Path: {
      const path = raw["path"];
      return typeof path === "string" && path !== "" ? { kind: MatchKind.Path, path } : undefined;
    }
    default:
      return undefined;
  }
}
