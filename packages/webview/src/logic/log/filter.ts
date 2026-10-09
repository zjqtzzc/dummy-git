import { assertNever, type CommitSkeleton } from "@dummy-git/shared";

/**
 * Log 的过滤条件（`.notes/design/phase-5.md`）。几种条件取交集；没有的条件就是不按它过滤。
 * 纯数据与纯函数，不依赖 Vue，能在 node 下测。
 */

/** 过滤栏上的四个按钮，各管一种条件。 */
export enum FilterKind {
  Branch = "branch",
  User = "user",
  Date = "date",
  Paths = "paths",
}

/** 日期过滤的三个预设。 */
export enum DateRange {
  Day = "day",
  Week = "week",
  Month = "month",
}

export interface LogFilter {
  readonly date?: DateRange;
  /** 搜索框里的字：按说明文字或 hash 前缀找。空着就是不按它过滤，不存空串。 */
  readonly text?: string;
}

/**
 * 搜索框那一项的结果。说明文字要问 git（`matchCommits`），回来之前列表按上一次的结果显示，
 * 所以结果连同它对应的那个搜索词一起存，hash 前缀也按那个词算，两半永远对得上。
 */
export interface TextMatch {
  readonly text: string;
  /** git 找到的：说明里含有 `text` 的提交。 */
  readonly byMessage: ReadonlySet<string>;
}

/** 4 个以上十六进制字符才当 hash 前缀：4 是 git 缩写的最短长度，免得 `add`、`fix` 这类短词误中。 */
const HASH_PREFIX = /^[0-9a-f]{4,}$/;

function matchesText(hash: string, match: TextMatch): boolean {
  if (match.byMessage.has(hash)) return true;
  const prefix = match.text.toLowerCase();
  return HASH_PREFIX.test(prefix) && hash.startsWith(prefix);
}

const DAY = 24 * 60 * 60;

function secondsOf(range: DateRange): number {
  switch (range) {
    case DateRange.Day:
      return DAY;
    case DateRange.Week:
      return 7 * DAY;
    case DateRange.Month:
      return 30 * DAY;
    default:
      return assertNever(range, "secondsOf");
  }
}

/** 有没有任何条件在生效。 */
export function isFiltering(filter: LogFilter): boolean {
  return filter.date !== undefined || filter.text !== undefined;
}

/**
 * 骨架里留下哪些（保持骨架的顺序），几种条件取交集。
 * 日期按骨架里的提交时间在这里筛，不问 git；搜索框那一项用 `text`（说明文字或 hash 前缀，取并集），
 * 不用 `filter.text`——git 的结果回来之前，列表照上一次的结果显示。
 * `now` 是 unix 秒，由调用方传入，便于测试。
 */
export function applyFilter(
  skeleton: readonly CommitSkeleton[],
  filter: LogFilter,
  now: number,
  text?: TextMatch,
): string[] {
  const since = filter.date === undefined ? undefined : now - secondsOf(filter.date);
  return skeleton
    .filter((commit) => since === undefined || commit.at >= since)
    .filter((commit) => text === undefined || matchesText(commit.hash, text))
    .map((commit) => commit.hash);
}

/**
 * 存进 `viewState` 的写法。存下来的值会离开这次构建（下个版本读它），所以 enum 的值不直接落盘，
 * 由这张表给出对外的字符串（CLAUDE.md B.2）。
 */
const SAVED_DATE: Readonly<Record<DateRange, string>> = {
  [DateRange.Day]: "24h",
  [DateRange.Week]: "7d",
  [DateRange.Month]: "30d",
};

export function saveFilter(filter: LogFilter): unknown {
  return {
    ...(filter.date === undefined ? {} : { date: SAVED_DATE[filter.date] }),
    ...(filter.text === undefined ? {} : { text: filter.text }),
  };
}

/** 读回存下的过滤条件。认不出的一项当作没有，不报错（旧版本存的、被改坏的）。 */
export function restoreFilter(saved: unknown): LogFilter {
  if (typeof saved !== "object" || saved === null) return {};
  const savedDate = Reflect.get(saved, "date");
  const date = Object.values(DateRange).find((range) => SAVED_DATE[range] === savedDate);
  const text = Reflect.get(saved, "text");
  return {
    ...(date === undefined ? {} : { date }),
    ...(typeof text === "string" && text !== "" ? { text } : {}),
  };
}
