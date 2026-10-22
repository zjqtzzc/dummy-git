import type { GitCommandRecord } from "../git/types.js";

/**
 * 给日志用的摘要：日志要精简，长的截断。
 *
 * 单个标识（hash、路径、分支名）不缩短：事后要拿完整 hash 找回东西。
 * 截的是「多」：多行、很长的一行、很多项。
 */

/** 单行字符串最多留多少字。 */
const STRING_CHARS = 120;
/** 列表最多列几项。 */
const LIST_ITEMS = 3;
/** git 命令行最多列几个参数（选项都在前面，后面多是路径）。 */
const GIT_ARGS = 12;
/** 附在一行下面的多行内容（stderr、调用栈）最多留几行。 */
const ATTACHED_LINES = 5;
/** 超过这么久算慢：行尾标 `(slow)`，记 warn。操作与 git 命令共用。 */
export const SLOW_MS = 1000;

/**
 * 任意值 → 一小段文字。对象展开一层，里面的列表列前几项（参数里的路径要看得到），
 * 再往里写成 `{…}` / `[N 项]`。
 */
export function brief(value: unknown): string {
  return describe(value, 0);
}

/** 结果的摘要：列表只记条数，`null` / `undefined` 不记（返回空串），其余同 `brief`。 */
export function briefResult(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return `${value.length} 项`;
  return brief(value);
}

function describe(value: unknown, depth: number): string {
  if (typeof value === "string") return JSON.stringify(briefString(value));
  if (Array.isArray(value)) {
    // 元素是对象的（状态里的文件、提交）列出来只是一排 `{…}`，只写条数；字符串（路径、hash）列前几项。
    if (depth > 1 || value.some((item) => isPlainObject(item))) {
      return `[${value.length} 项]`;
    }
    const shown = value.slice(0, LIST_ITEMS).map((item) => describe(item, depth + 1));
    const more = value.length > LIST_ITEMS ? ` …（共 ${value.length} 项）` : "";
    return `[${shown.join(", ")}${more}]`;
  }
  if (typeof value === "object" && value !== null) {
    if (depth > 0) return "{…}";
    const fields = Object.entries(value).map(
      ([key, field]) => `${key}: ${describe(field, depth + 1)}`,
    );
    return `{${fields.join(", ")}}`;
  }
  return String(value);
}

/** 多行只留第一行；单行太长截断。都注明原来有多长。 */
export function briefString(text: string): string {
  const lines = text.trimEnd().split("\n");
  const first = lines[0] ?? "";
  if (lines.length > 1) return `${clip(first)} …（共 ${lines.length} 行）`;
  if (first.length > STRING_CHARS) return `${clip(first)} …（共 ${first.length} 字）`;
  return first;
}

/**
 * 一条 git 命令写成日志：`> git <参数> [用时] <结局>`，慢的标 `(slow)`；有 stderr 的另起几行缩进写上。
 * `--format=` 的值是一长串分隔符，刷屏且无信息量，折叠成 `--format=...`。
 */
export function briefGitCommand(record: GitCommandRecord): {
  readonly line: string;
  readonly slow: boolean;
} {
  const shown = record.args.slice(0, GIT_ARGS).map((arg) => {
    if (arg.startsWith("--format=")) return "--format=...";
    if (arg === "") return '""';
    return arg.includes(" ") ? `"${arg}"` : arg;
  });
  const more = record.args.length > GIT_ARGS ? ` …（共 ${record.args.length} 个参数）` : "";
  const slow = record.ms > SLOW_MS;
  const head = `> git ${shown.join(" ")}${more} [${record.ms}ms] ${record.outcome}${slow ? " (slow)" : ""}`;
  return { line: withAttached(head, record.stderr), slow };
}

/** 一行，下面缩进附上多行内容（stderr、调用栈），最多 `ATTACHED_LINES` 行。内容为空就只有那一行。 */
export function withAttached(head: string, text: string): string {
  const lines = text
    .trimEnd()
    .split("\n")
    .filter((line) => line !== "");
  const kept = lines.slice(0, ATTACHED_LINES).map((line) => `    ${line}`);
  if (lines.length > ATTACHED_LINES) kept.push(`    …（共 ${lines.length} 行）`);
  return [head, ...kept].join("\n");
}

function clip(line: string): string {
  return line.slice(0, STRING_CHARS);
}

function isPlainObject(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
