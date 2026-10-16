/**
 * 写进日志的数据都先过这里（`CLAUDE.md` G）：日志要精简，长的截断，规则全在这一处。
 *
 * 单个标识（hash、路径、分支名）不缩短：事后要拿完整 hash 找回东西。
 * 截的是「多」：多行、很长的一行、很多项。
 */

/** 单行字符串最多留多少字。 */
const STRING_CHARS = 120;
/** 列表最多列几项。 */
const LIST_ITEMS = 3;

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

function clip(line: string): string {
  return line.slice(0, STRING_CHARS);
}

function isPlainObject(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
