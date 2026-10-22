import { assertNever, type CommitSkeleton, type PickedAuthor } from "@dummy-git/shared";

/** Log 的过滤条件。几种条件取交集；没有的条件就是不按它过滤。 */

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

/** 按分支过滤：只看这一个分支的历史。 */
export interface BranchFilter {
  /** 完整引用名（`refs/heads/x`、`refs/remotes/origin/x`），交给骨架命令当起点。 */
  readonly ref: string;
  /** 给人看的（`x`、`origin/x`）。 */
  readonly name: string;
}

export interface LogFilter {
  /** 分支不在 `applyFilter` 里筛：它换的是骨架的起点，骨架整个重取。 */
  readonly branch?: BranchFilter;
  readonly date?: DateRange;
  /** 搜索框里的字：按说明文字或 hash 前缀找。空着就是不按它过滤，不存空串。 */
  readonly text?: string;
  /** 作者（User 按钮选的）。 */
  readonly author?: PickedAuthor;
  /** 改过这个目录或文件（Paths 按钮选的），相对仓库根。 */
  readonly path?: string;
}

/** 要问 git 的那几项的结果。回来之前列表照上一次的结果显示。 */
export interface Matches {
  readonly text?: TextMatch;
  /** 作者是选中那个人的提交。 */
  readonly author?: ReadonlySet<string>;
  /** 改过选中路径的提交。 */
  readonly path?: ReadonlySet<string>;
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
  return (
    filter.branch !== undefined ||
    filter.date !== undefined ||
    filter.text !== undefined ||
    filter.author !== undefined ||
    filter.path !== undefined
  );
}

/**
 * 骨架里留下哪些（保持骨架的顺序），几种条件取交集。
 * 日期按骨架里的提交时间在这里筛，不问 git；要问 git 的几项用 `matches`（搜索框那一项是说明文字
 * 或 hash 前缀，取并集），不看 `filter` 里的值——git 的结果回来之前，列表照上一次的结果显示。
 * `matches` 里缺席的一项就是不按它过滤，由调用方保证只放生效中的条件。
 * `now` 是 unix 秒，由调用方传入，便于测试。
 */
export function applyFilter(
  skeleton: readonly CommitSkeleton[],
  filter: LogFilter,
  now: number,
  matches: Matches,
): string[] {
  const since = filter.date === undefined ? undefined : now - secondsOf(filter.date);
  const { text, author, path } = matches;
  return skeleton
    .filter((commit) => since === undefined || commit.at >= since)
    .filter((commit) => text === undefined || matchesText(commit.hash, text))
    .filter((commit) => author === undefined || author.has(commit.hash))
    .filter((commit) => path === undefined || path.has(commit.hash))
    .map((commit) => commit.hash);
}

/** 存进 `viewState` 的写法。 */
const SAVED_DATE: Readonly<Record<DateRange, string>> = {
  [DateRange.Day]: "24h",
  [DateRange.Week]: "7d",
  [DateRange.Month]: "30d",
};

export function saveFilter(filter: LogFilter): unknown {
  return {
    ...(filter.branch === undefined ? {} : { branch: { ...filter.branch } }),
    ...(filter.date === undefined ? {} : { date: SAVED_DATE[filter.date] }),
    ...(filter.text === undefined ? {} : { text: filter.text }),
    ...(filter.author === undefined ? {} : { author: { ...filter.author } }),
    ...(filter.path === undefined ? {} : { path: filter.path }),
  };
}

/** 读回存下的过滤条件。认不出的一项当作没有，不报错（旧版本存的、被改坏的）。 */
export function restoreFilter(saved: unknown): LogFilter {
  if (typeof saved !== "object" || saved === null) return {};
  const savedDate = Reflect.get(saved, "date");
  const date = Object.values(DateRange).find((range) => SAVED_DATE[range] === savedDate);
  const text = Reflect.get(saved, "text");
  const author = restoreAuthor(Reflect.get(saved, "author"));
  const path = Reflect.get(saved, "path");
  const branch = restoreBranch(Reflect.get(saved, "branch"));
  return {
    ...(branch === undefined ? {} : { branch }),
    ...(date === undefined ? {} : { date }),
    ...(typeof text === "string" && text !== "" ? { text } : {}),
    ...(author === undefined ? {} : { author }),
    ...(typeof path === "string" && path !== "" ? { path } : {}),
  };
}

function restoreBranch(saved: unknown): BranchFilter | undefined {
  if (typeof saved !== "object" || saved === null) return undefined;
  const ref = Reflect.get(saved, "ref");
  const name = Reflect.get(saved, "name");
  return typeof ref === "string" && typeof name === "string" ? { ref, name } : undefined;
}

function restoreAuthor(saved: unknown): PickedAuthor | undefined {
  if (typeof saved !== "object" || saved === null) return undefined;
  const name = Reflect.get(saved, "name");
  const email = Reflect.get(saved, "email");
  const me = Reflect.get(saved, "me");
  return typeof name === "string" && typeof email === "string" && typeof me === "boolean"
    ? { name, email, me }
    : undefined;
}
