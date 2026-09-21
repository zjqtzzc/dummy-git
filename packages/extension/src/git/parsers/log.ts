/**
 * `git log` 的命令与解析。**两个查询**，对应取数模型 B（见 `.notes/design/M3-parsers.md` §4.2）：
 *
 *   骨架  git log HEAD --branches --remotes --tags --date-order --format=<3 字段>
 *   详情  git log --no-walk --stdin --format=<9 字段>    按 hash 取，显示用
 *
 * 命令行与解析代码**必须放在同一个文件里**：`--format` 声明有几个字段、
 * 解析按几个字段切，这是一份契约的两半。分开放两个文件，改一边忘了另一边就静默错位，
 * 而且错位之后每个字段都还是「一个字符串」，类型上完全合法，只有显示出来才看得出不对。
 *
 * 两个查询也放在一起，因为它们共用记录分隔符与「跳过 git 加的换行」这些格式知识——
 * 拆开就要复制常量，那正是漂移的开始。
 */
import type { Commit, CommitSkeleton, Signature } from "@dummy-git/shared";
import { GitParseError } from "./errors.js";
import { decode, split } from "./scan.js";

const NUL = 0x00;
const LF = 0x0a;
const CR = 0x0d;

/**
 * 记录分隔符。
 *
 * 用 `\0\0\x01` 而不是换行：提交消息可以包含**任何字符，包括换行**，
 * 所以「按行切记录」从根上就是错的。而 `\0` 不可能出现在提交消息里
 * （git 的对象格式本身不允许），所以不用赌、不用正则、不用为解析牺牲功能。
 *
 * 对照另外两家的取舍：vscode 用换行分字段 + `-z` 分记录，代价是只能靠正则 + 字段
 * 顺序固定来解析；git-graph 赌一串随机魔法字符串，且因为用换行分记录，
 * 列表里只能拿单行 subject，完整消息要再查一次 git。
 *
 * `\x01` 单独出现是合法的（fixture 里就有一条这样的提交），
 * 只有紧跟在两个 `\0` 之后才构成分隔符。
 */
const RECORD_SEP = Buffer.from([0x00, 0x00, 0x01]);

/** 一条切好的记录：解码后的字段，外加一个带足现场信息的报错构造器。 */
interface LogRecord {
  readonly fields: readonly string[];
  readonly fail: (detail: string) => GitParseError;
}

/**
 * 切记录、切字段、校验字段数。两个查询共用。
 *
 * 字段数是**唯一的校验点**，也是 `\0\0\x01` 这个记录分隔符存在的意义：
 * 有记录边界才能验字段数对不对。数不对说明 format 与解析脱节，或 git 换了输出格式——
 * 继续解析只会把错位的值当成正确的值发出去。
 */
function splitRecords(stdout: Buffer, parser: string, fieldCount: number): LogRecord[] {
  const records: LogRecord[] = [];

  for (const [index, rawRecord] of split(stdout, RECORD_SEP).entries()) {
    // git 在每条 --format 记录后面自己加一个换行，它落在下一条的开头。
    let start = rawRecord.start;
    while (start < rawRecord.end && (stdout[start] === LF || stdout[start] === CR)) start++;
    // 整段输出以 `\0\0\x01\n` 结束，最后那个换行会被切成一条空记录。
    if (start >= rawRecord.end) continue;

    const range = { start, end: rawRecord.end };
    const fail = (detail: string): GitParseError =>
      new GitParseError({ parser, recordIndex: index, detail, buf: stdout, range });

    const fields = split(stdout, NUL, start, rawRecord.end).map((field) => decode(stdout, field));
    if (fields.length !== fieldCount) {
      throw fail(`期望 ${fieldCount} 个字段，实际 ${fields.length} 个`);
    }
    records.push({ fields, fail });
  }

  return records;
}

function at(record: LogRecord, position: number): string {
  const value = record.fields[position];
  // 上面刚验过字段数，走不到这里；写出来是因为 noUncheckedIndexedAccess 要求，
  // 而且真走到了也不该拿别的值顶替——那正是「静默错位」本身。
  if (value === undefined) throw record.fail(`缺少第 ${position} 个字段`);
  return value;
}

/**
 * 父提交列表。
 *
 * 根提交的 `%P` 是**空字符串**，而 `"".split(" ")` 得到的是 `[""]`——
 * 那会凭空造出一个 hash 为空串的假父提交，画图时表现成一条通向图外的线，
 * 不报任何错。必须显式判空。
 */
function parseParents(raw: string): string[] {
  return raw === "" ? [] : raw.split(" ");
}

function parseTimestamp(record: LogRecord, raw: string, label: string): number {
  const seconds = Number(raw);
  if (!Number.isFinite(seconds)) throw record.fail(`${label}不是数字：${raw}`);
  return seconds;
}

/**
 * 每条 `git log` 命令都要带的前缀。
 *
 * `log.showSignature` 被用户打开时，git 会往每条提交插入 GPG 签名验证信息，
 * `--format` 的输出直接被破坏（实测：记录开头变成 `Good "git" signature for …`，
 * hash 字段整个错位）。vscode 与旧仓库都没防这一条（各搜 0 处）——
 * 这种 bug 只在特定用户机器上出现，本地永远复现不了。
 */
/**
 * 所有 `git log` 查询共用的前缀。
 *
 * `-c log.showSignature=false`：用户在 `~/.gitconfig` 里设了
 * `log.showSignature = true`（用 GPG/SSH 签名的人常设），git 会在**每条**提交前
 * 插入一行签名验证结果，把 `--format` 的输出整个顶歪。实测（空 format 也照样污染）：
 * `Good "git" signature for a@b.c with ED25519 key SHA256:…`
 * 这种 bug 只在特定用户机器上出现，本地永远复现不了。两个参照实现都没有这条防护。
 *
 * 由 `nameStatus.ts` 一并引用——它也是一条 `git log` 查询，同样会被污染。
 */
export const LOG_PREFIX = ["-c", "log.showSignature=false", "log"];

// ────────────────────────────── 骨架 ──────────────────────────────

const SKELETON_FORMAT = "%H%x00%P%x00%ct%x00%x00%x01";

const SK_HASH = 0;
const SK_PARENTS = 1;
const SK_TIME = 2;
const SK_FIELD_COUNT = 3;

/**
 * 全量骨架：跑遍整个历史，只取画图必需的三个字段。
 *
 * ## 为什么不是 `--all`（2026-09-21 修，这是个已发布的缺陷）
 *
 * `--all` 会把 **stash 及其内部实现提交**一并列进来。实测（两条提交 + 一次 stash）：
 *
 * ```
 * $ git log --all --oneline
 * a311794 正常提交2
 * af844da WIP on master: a311794 正常提交2      ← stash 提交
 * bc1cc64 正常提交1
 * a3baced index on master: a311794 正常提交2    ← stash 的**内部 index 提交**
 * ```
 *
 * 用户只要 stash 过一次，提交列表就凭空多两条，其中 `index on master`
 * 是 git stash 的内部实现细节，完全不该出现在界面上。
 *
 * IntelliJ 用的是显式三件套（`GitLogUtil.java:75`），注释写得很直白：
 * *"equivalent to `--all`, but doesn't show the stuff from index or stash"*。
 *
 * `--date-order`：按提交时间排，与 `CommitSkeleton.at` 一致。
 *
 * 实测代价（vscode 仓库 188,163 条提交）：1.6 秒 / 18 MB 输出。
 * 带上作者与消息的话是 46 MB，而画图用不到那 28 MB。
 */
export function skeletonArgs(): string[] {
  // 顺序对齐 IntelliJ 的 LOG_ALL：HEAD / 分支 / 远程 / 标签。
  return [
    ...LOG_PREFIX,
    `--format=${SKELETON_FORMAT}`,
    "HEAD",
    "--branches",
    "--remotes",
    "--tags",
    "--date-order",
  ];
}

export function parseSkeleton(stdout: Buffer): CommitSkeleton[] {
  return splitRecords(stdout, "parseSkeleton", SK_FIELD_COUNT).map((record) => ({
    hash: at(record, SK_HASH),
    parents: parseParents(at(record, SK_PARENTS)),
    at: parseTimestamp(record, at(record, SK_TIME), "提交时间"),
  }));
}

// ────────────────────────────── 详情 ──────────────────────────────

/**
 * `%aN`/`%aE` 是大写：走 **mailmap**（把同一个人的多个邮箱归一），
 * `%an`/`%ae` 才是提交里的原始值。`FEATURES.md §2.2` 明确要求走 mailmap——
 * 不归一的话，按作者过滤时一个人会被拆成好几个。
 */
const LOG_FORMAT = "%H%x00%P%x00%aN%x00%aE%x00%at%x00%cN%x00%cE%x00%ct%x00%B%x00%x00%x01";

const HASH = 0;
const PARENTS = 1;
const AUTHOR_NAME = 2;
const AUTHOR_EMAIL = 3;
const AUTHOR_DATE = 4;
const COMMITTER_NAME = 5;
const COMMITTER_EMAIL = 6;
const COMMITTER_DATE = 7;
const MESSAGE = 8;
const FIELD_COUNT = 9;

/** 一条要喂 stdin 的命令：参数与输入必须一起给，分开就可能忘掉输入。 */
export interface StdinCommand {
  readonly args: string[];
  readonly input: string;
}

/**
 * 按 hash 取详情。
 *
 * `--no-walk`：只输出给定的这些提交，**不遍历它们的历史**。
 * `--stdin`：hash 列表从标准输入读——命令行长度有上限，几百个 hash 就可能超。
 *
 * 返回值把 `args` 与 `input` 绑在一起：`GitCli` 的 stdin 是可选参数，
 * 忘了传的话 git 读到立刻 EOF、返回空结果而**不报错**（M2 §4.3 实测过这类静默行为）。
 * 绑成一个值，就没有「忘了传」这种用法。
 */
export function detailsArgs(hashes: readonly string[]): StdinCommand {
  return {
    args: [...LOG_PREFIX, `--format=${LOG_FORMAT}`, "--no-walk", "--stdin"],
    input: hashes.length === 0 ? "" : `${hashes.join("\n")}\n`,
  };
}

export function parseLog(stdout: Buffer): Commit[] {
  return splitRecords(stdout, "parseLog", FIELD_COUNT).map((record) => {
    const author: Signature = {
      name: at(record, AUTHOR_NAME),
      email: at(record, AUTHOR_EMAIL),
      at: parseTimestamp(record, at(record, AUTHOR_DATE), "作者时间"),
    };
    const committer: Signature = {
      name: at(record, COMMITTER_NAME),
      email: at(record, COMMITTER_EMAIL),
      at: parseTimestamp(record, at(record, COMMITTER_DATE), "提交时间"),
    };
    return {
      hash: at(record, HASH),
      parents: parseParents(at(record, PARENTS)),
      author,
      committer,
      // 剥掉结尾换行：`%B` 的结尾换行数量是 0/1/3 不等（取决于提交时的 cleanup 设置），
      // 留着的话每个用到 message 的地方都得各自规范化，迟早写得不一致。
      // 这是数据层唯一的规范化动作，其余一律原样。
      message: at(record, MESSAGE).replace(/\n+$/, ""),
    };
  });
}
