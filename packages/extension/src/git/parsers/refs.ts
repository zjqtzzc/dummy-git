/**
 * 分支、标签、HEAD 的命令与解析。
 *
 * 用 `for-each-ref` 而不是 `git log` 的 `%D`：`%D` 给的是 `origin/main` 这种字符串，
 * **分不出它是远程分支还是一个恰好叫这名字的本地分支**。
 * `for-each-ref` 给完整路径（`refs/heads/…` / `refs/remotes/…` / `refs/tags/…`），零歧义。
 */
import { type Ref, RefKind, type Upstream, UpstreamState } from "@dummy-git/shared";
import { GitParseError } from "./errors.js";
import { decode, split } from "./scan.js";

const NUL = 0x00;
const RECORD_SEP = Buffer.from([0x00, 0x00, 0x01]);

const LOCAL_PREFIX = "refs/heads/";
const REMOTE_PREFIX = "refs/remotes/";
const TAG_PREFIX = "refs/tags/";

const REFNAME = 0;
const OBJECT_TYPE = 1;
const OBJECT_NAME = 2;
const PEELED_NAME = 3;
const UPSTREAM_REMOTE = 4;
const UPSTREAM_REF = 5;
const UPSTREAM_TRACK = 6;
const FIELD_COUNT = 7;

/**
 * **`for-each-ref` 用 `%00`，不是 `git log` 的 `%x00`。**
 * 两条命令的转义语法不一样，写错了不会报错——`%x00` 会原样输出成六个字符，
 * 于是整条记录变成一个字段。
 */
const REFS_FORMAT =
  "%(refname)%00%(objecttype)%00%(objectname)%00%(*objectname)%00" +
  "%(upstream:remotename)%00%(upstream:remoteref)%00%(upstream:track)%00%00%01";

/**
 * `%(upstream:track)` 是给人看的文字，四种形态：
 * `[ahead 2]` / `[behind 1]` / `[ahead 1, behind 1]` / `[gone]` / 空串。
 *
 * 注意 behind 为 0 时**整项省略**，不是 `[ahead 2, behind 0]`。
 */
const TRACK_PATTERN = /\[(?:ahead (\d+))?(?:, )?(?:behind (\d+))?]/;
const GONE = "[gone]";

export function refsArgs(): string[] {
  return ["for-each-ref", `--format=${REFS_FORMAT}`, "refs/heads", "refs/remotes", "refs/tags"];
}

/** HEAD 不在 `refs/` 下，`for-each-ref` 列不到它（`--include-root-refs` 要 git 2.45）。 */
export function headArgs(): string[] {
  // 一条命令两行：第一行是 sha，第二行是 `refs/heads/xxx`，detached 时是字面量 `HEAD`。
  return ["rev-parse", "HEAD", "--symbolic-full-name", "HEAD"];
}

/**
 * 把 `refs/remotes/origin/feat/x` 拆成远程名与分支名。
 *
 * **在第一个斜杠处拆**：远程名不含斜杠，而分支名可以（`feat/x`）。
 */
function splitRemote(rest: string): { remote: string; name: string } | undefined {
  const slash = rest.indexOf("/");
  if (slash <= 0 || slash === rest.length - 1) return undefined;
  return { remote: rest.slice(0, slash), name: rest.slice(slash + 1) };
}

/**
 * 上游。
 *
 * 用 `%(upstream:remotename)` + `%(upstream:remoteref)` 而不是解析 `%(upstream)` 的前缀：
 *
 * **分支可以跟踪本地分支**（`git branch --set-upstream-to=main feature`），
 * 那时 `%(upstream)` 是 `refs/heads/main` 而不是 `refs/remotes/…`。
 * 按前缀拆的写法会把它当成「没有上游」，连带丢掉 ahead/behind——
 * 而这是个完全合法的 git 配置。
 *
 * git 自己把本地仓库表示成远程 `.`（配置里就是 `branch.feature.remote = .`），
 * 所以 `{ remote: ".", name: "main" }` 不是将就，是 git 的原生表示。
 * 两种上游在这两个字段上格式完全一致：`remotename` 是 `origin` 或 `.`，
 * `remoteref` 一律是 `refs/heads/<名字>`。
 */
function parseUpstream(remote: string, remoteRef: string, track: string): Upstream | undefined {
  // 没配上游。注意「已同步」的 track 也是空串，只能靠这里区分——
  // 两者都空的话会把已同步的分支当成没上游。
  if (remote === "" || !remoteRef.startsWith(LOCAL_PREFIX)) return undefined;
  const parts = { remote, name: remoteRef.slice(LOCAL_PREFIX.length) };

  if (track === GONE) {
    return { ...parts, state: { kind: UpstreamState.Gone } };
  }
  const matched = TRACK_PATTERN.exec(track);
  return {
    ...parts,
    state: {
      kind: UpstreamState.Tracking,
      // 匹配不上（track 为空 = 完全同步）时两边都是 0。
      ahead: Number(matched?.[1] ?? 0),
      behind: Number(matched?.[2] ?? 0),
    },
  };
}

export function parseRefs(stdout: Buffer): Ref[] {
  const refs: Ref[] = [];

  for (const [index, record] of split(stdout, RECORD_SEP).entries()) {
    // 每条记录后面跟着 git 自己加的换行，末尾那个会被切成一条只含换行的记录。
    let start = record.start;
    while (start < record.end && (stdout[start] === 0x0a || stdout[start] === 0x0d)) start++;
    if (start >= record.end) continue;

    const fields = split(stdout, NUL, start, record.end);
    const fail = (detail: string): GitParseError =>
      new GitParseError({
        parser: "parseRefs",
        recordIndex: index,
        detail,
        buf: stdout,
        range: record,
      });

    if (fields.length !== FIELD_COUNT) {
      throw fail(`期望 ${FIELD_COUNT} 个字段，实际 ${fields.length} 个`);
    }
    const at = (position: number): string => {
      const field = fields[position];
      if (field === undefined) throw fail(`缺少第 ${position} 个字段`);
      return decode(stdout, field);
    };

    const refname = at(REFNAME);
    // 附注标签是独立对象，`%(objectname)` 是标签对象自己的 hash，
    // 拿它去提交列表里找一条都找不到。剥壳后的 `%(*objectname)` 才是提交。
    const peeled = at(PEELED_NAME);
    const target = peeled === "" ? at(OBJECT_NAME) : peeled;

    if (refname.startsWith(LOCAL_PREFIX)) {
      const upstream = parseUpstream(at(UPSTREAM_REMOTE), at(UPSTREAM_REF), at(UPSTREAM_TRACK));
      const name = refname.slice(LOCAL_PREFIX.length);
      // exactOptionalPropertyTypes：没上游时该字段必须不存在，不能是 undefined。
      refs.push(
        upstream === undefined
          ? { kind: RefKind.LocalBranch, name, target }
          : { kind: RefKind.LocalBranch, name, target, upstream },
      );
      continue;
    }

    if (refname.startsWith(REMOTE_PREFIX)) {
      const parts = splitRemote(refname.slice(REMOTE_PREFIX.length));
      if (parts === undefined) throw fail(`远程分支名拆不开：${refname}`);
      refs.push({ kind: RefKind.RemoteBranch, remote: parts.remote, name: parts.name, target });
      continue;
    }

    if (refname.startsWith(TAG_PREFIX)) {
      refs.push({
        kind: RefKind.Tag,
        name: refname.slice(TAG_PREFIX.length),
        target,
        annotated: at(OBJECT_TYPE) === "tag",
      });
      continue;
    }

    // 只传了三个前缀，出现别的说明命令被改过而这里没跟上。
    throw fail(`未知的引用前缀：${refname}`);
  }

  return refs;
}

/** 解析 `headArgs()` 的输出：第一行 sha，第二行分支全名或字面量 `HEAD`。 */
export function parseHead(stdout: Buffer): Ref {
  const lines = decode(stdout, { start: 0, end: stdout.length }).split("\n");
  const target = lines[0] ?? "";
  const symbolic = lines[1] ?? "";
  if (target === "") {
    throw new GitParseError({
      parser: "parseHead",
      recordIndex: -1,
      detail: "拿不到 HEAD 的 sha",
      buf: stdout,
      range: { start: 0, end: stdout.length },
    });
  }
  // detached 时 --symbolic-full-name 原样输出 `HEAD`，不是某个 refs/heads/xxx。
  return symbolic.startsWith(LOCAL_PREFIX)
    ? { kind: RefKind.Head, target, branch: symbolic.slice(LOCAL_PREFIX.length) }
    : { kind: RefKind.Head, target };
}
