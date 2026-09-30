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
  DiffOpenMode,
  type DiffSide,
  DiffSideKind,
  type Generation,
  type InboundMessage,
  MessageKind,
} from "@dummy-git/shared";

function isRecord(value: unknown): value is Record<string, unknown> {
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
 * 每条命令怎么把 `unknown` 变成它的参数类型。
 *
 * **与 `Commands` 是两张表，但回答的是两个不同的问题**：`Commands` 说
 * 「参数的类型是什么」，这里说「一个运行时的值是不是那个类型」。
 * TypeScript 无法从类型推出校验器（类型不在运行时存在），所以这份重复是必要的，
 * 不是 D.5.1(d) 说的「同一个问题被回答两次」。
 *
 * `satisfies` 保证这张表**每条命令都有**，漏一条编译不过——
 * 与 `defineHandlers` 同一个思路：完整性由编译器管，不靠记性。
 */
const PARAM_GUARDS = {
  // 没有参数。仍然要有一条守卫——表必须是完整的，`satisfies` 才拦得住漏写。
  getRepositories: () => ({}),
  getSkeleton: (raw: Record<string, unknown>) => {
    const repo = raw["repo"];
    return typeof repo === "string" ? { repo } : undefined;
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
  getStatus: (raw: Record<string, unknown>) => {
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

/**
 * 校验整个信封。
 *
 * 返回 `undefined` 表示「这条消息不可理解」——**连回复都没法回**
 * （不知道 id、不知道代号），只能丢弃并记日志。这与「命令执行失败」
 * 是两件事：后者有 id，能好好回一个错误响应。
 */
export function parseInbound(raw: unknown): InboundMessage | undefined {
  if (!isRecord(raw)) return undefined;

  const generation = asGeneration(raw["generation"]);
  if (generation === undefined) return undefined;

  if (raw["kind"] === MessageKind.Ready) {
    return { kind: MessageKind.Ready, generation };
  }

  if (raw["kind"] === MessageKind.Request) {
    const id = raw["id"];
    if (typeof id !== "number" || !Number.isInteger(id)) return undefined;
    if (!isCommandName(raw["command"])) return undefined;

    const params = parseParams(raw["command"], raw["params"]);
    if (params === undefined) return undefined;

    return { kind: MessageKind.Request, generation, id, command: raw["command"], params };
  }

  return undefined;
}
