<script setup lang="ts">
import {
  assertNever,
  type Commit,
  type CommitFileChange,
  type CommitSkeleton,
  type DiffOpenMode,
  GitDomain,
  type MatchCondition,
  MatchKind,
  type Ref,
  RefKind,
} from "@dummy-git/shared";
import type { VscodeSplitLayout } from "@vscode-elements/elements/dist/vscode-split-layout/vscode-split-layout.js";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { type Client, copyText, report } from "../logic/client.js";
import { AppIcon, appIcon, codicon } from "../logic/icons.js";
import {
  type BranchNode,
  branchFilters,
  DELETE_BRANCHES,
  NEW_BRANCH,
  UPDATE_BRANCH,
} from "../logic/log/branchTree.js";
import { commitDetailsView } from "../logic/log/commitDetails.js";
import { commitDiffSides, commitFileEntry } from "../logic/log/commitDiff.js";
import { commitCopyText } from "../logic/log/copy.js";
import {
  applyFilter,
  DateRange,
  FilterKind,
  isFiltering,
  type LogFilter,
  type Matches,
  restoreFilter,
  saveFilter,
} from "../logic/log/filter.js";
import { buildColors } from "../logic/log/graph/color.js";
import { buildLayout } from "../logic/log/graph/layout.js";
import { buildGraph } from "../logic/log/graph/rows.js";
import { buildStructure, sameCommit } from "../logic/log/graph/structure.js";
import { visibleLines, visibleRows } from "../logic/log/graph/visible.js";
import { graphOptionsMenu, restoreOrder, saveOrder } from "../logic/log/graphOptions.js";
import {
  HIGHLIGHT_MENU,
  type Highlight,
  headReach,
  restoreHighlights,
  saveHighlights,
} from "../logic/log/highlight.js";
import { type Layout, restoreLayout, splitPercent, splitPosition } from "../logic/log/layout.js";
import { hashesToFetch } from "../logic/log/prefetch.js";
import { refLabels } from "../logic/log/refLabels.js";
import { rewordable } from "../logic/log/rewordable.js";
import type { MenuViews } from "../logic/menuItems.js";
import { type PopupItem, PopupItemKind } from "../logic/popupMenu.js";
import {
  EMPTY_SELECTION,
  retain,
  type Selection,
  selectOnly,
  singleOf,
} from "../logic/selection.js";
import type { FileRow } from "../logic/tree/fileTree.js";
import { keepIfSame } from "../logic/utils/list.js";
import type { RowRange } from "../logic/virtualList.js";
import FileTree from "../tree/FileTree.vue";
import ToolButton from "../ui/ToolButton.vue";
import { viewState } from "../vscodeApi.js";
import BranchTree from "./BranchTree.vue";
import CommitList from "./CommitList.vue";
import FilterBar from "./FilterBar.vue";

/** 底部 Log 面板：左分支树、中提交列表、右边选中提交的文件树。 */
const props = defineProps<{ client: Client }>();

/** `ref`：`.value` 一改，用到它的模板就重画。 */
const repo = ref<string>();
/** 骨架，最多一万条。 */
const skeleton = ref<readonly CommitSkeleton[]>([]);
/** 已经取到的详情。同一个 hash 的内容永远不变，刷新时不清。 */
const details = ref(new Map<string, Commit>());
/** 正在路上的详情请求，避免重复要。不参与界面，不用 ref。 */
const inFlight = new Set<string>();
const loaded = ref(false);
/** 分支、tag 与 HEAD，左栏用。 */
const refs = ref<Ref[]>([]);
/** 「我」（mailmap 换算过，My Commits 高亮），和骨架一起取。没配名字时为 `null`。 */
const me = ref<{ readonly name: string; readonly email: string } | null>(null);
/** 骨架里从 HEAD 能走到的起点（`getHeadBases`），和骨架一起取。 */
const headBases = ref<readonly string[]>([]);
const selection = ref<Selection>(EMPTY_SELECTION);
/** 恰好选中一条时是它：右栏只在这时显示文件与详情。 */
const selected = computed(() => singleOf(selection.value));
const files = ref<CommitFileChange[]>([]);
/** 右栏只有一组，没有标题。 */
const fileGroups = computed(() => [{ id: "files", entries: files.value.map(commitFileEntry) }]);
/** 右栏下半部分：选中提交的详情。没有选中、或详情还没取到时缺席，那块留空。 */
const selectedDetails = computed(() => {
  const commit = selected.value === undefined ? undefined : details.value.get(selected.value);
  return commit === undefined ? undefined : commitDetailsView(commit);
});
/** 右栏正在取选中提交的文件。 */
const filesLoading = ref(false);
const list = ref<InstanceType<typeof CommitList>>();
const branchTree = ref<InstanceType<typeof BranchTree>>();

/** 「现在」，秒。每 30 秒走一次，「5 minutes ago」才会跟着变。 */
const now = ref(Math.floor(Date.now() / 1000));
const clock = setInterval(() => {
  now.value = Math.floor(Date.now() / 1000);
}, 30_000);
onUnmounted(() => clearInterval(clock));

/** 过滤条件。存进 `viewState`：重新加载窗口后还在。 */
const filter = ref<LogFilter>(restoreFilter(viewState.read("logFilter")));
/**
 * 一种要问 git 的条件（说明文字、作者）：条件或骨架变了就问一次，只收最新一次的结果（先发的可能后回来）。
 * 骨架变了（仓库有变化）也重查，同一个条件在新的一万条里重新找。结果连同它对应的条件一起存：
 * 回来之前列表照上一次的结果显示，条件清掉时作废。
 */
function useMatch(condition: () => MatchCondition | undefined) {
  const result = ref<{ readonly condition: MatchCondition; readonly hashes: ReadonlySet<string> }>();
  let seq = 0;
  // 按内容比：过滤条件整个换了新对象（比如只改了日期）时，这一项没变就不重查。
  watch([() => JSON.stringify(condition() ?? null), skeleton], async () => {
    const mine = ++seq;
    const current = condition();
    if (current === undefined) {
      result.value = undefined;
      return;
    }
    if (repo.value === undefined || skeleton.value.length === 0) return;
    try {
      const found = await props.client.request("matchCommits", {
        repo: repo.value,
        hashes: skeleton.value.map((commit) => commit.hash),
        condition: current,
      });
      if (mine === seq) result.value = { condition: current, hashes: new Set(found) };
    } catch (cause) {
      report(cause);
    }
  });
  return { result };
}

const byText = useMatch(() =>
  filter.value.text === undefined ? undefined : { kind: MatchKind.Text, text: filter.value.text },
);
const byAuthor = useMatch(() => {
  const author = filter.value.author;
  return author === undefined
    ? undefined
    : { kind: MatchKind.Author, name: author.name, email: author.email };
});
const byPath = useMatch(() =>
  filter.value.path === undefined ? undefined : { kind: MatchKind.Path, path: filter.value.path },
);

/** 生效中的那几项的结果：条件清掉了就没有。搜索框那一项带着它的搜索词，hash 前缀按那个词算。 */
const matches = computed((): Matches => {
  const text = byText.result.value;
  const author = byAuthor.result.value;
  const path = byPath.result.value;
  return {
    ...(filter.value.text === undefined || text?.condition.kind !== MatchKind.Text
      ? {}
      : { text: { text: text.condition.text, byMessage: text.hashes } }),
    ...(filter.value.author === undefined || author === undefined ? {} : { author: author.hashes }),
    ...(filter.value.path === undefined || path === undefined ? {} : { path: path.hashes }),
  };
});
/**
 * 列表里显示的提交：骨架按过滤条件筛过，顺序不变。
 * 每 30 秒随时钟重算一次；结果没变就沿用上一次的数组，列表和图不跟着重算。
 */
const hashes = computed((previous?: readonly string[]) =>
  keepIfSame(previous, applyFilter(skeleton.value, filter.value, now.value, matches.value)),
);

/** 提交图。行号图、编号与颜色只随骨架和 refs 变；筛选只换要画的线和取哪些行。 */
const structure = computed(() => buildStructure(skeleton.value));
const graphLayout = computed(() => buildLayout(structure.value, refs.value));
const colors = computed(() => buildColors(graphLayout.value));
const graph = computed(() => {
  const rows = visibleRows(structure.value, hashes.value);
  return buildGraph(
    visibleLines(structure.value, rows),
    rows.map((row) => graphLayout.value.indexes.at(row) ?? 0),
    rows.map((row) => colors.value.at(row)),
  );
});

/** 每个提交上的 ref 标签。 */
const labels = computed(() => refLabels(refs.value));
/** 合并提交（不止一个父提交），提交列表的右键菜单用。 */
const merges = computed(
  () => new Set(skeleton.value.flatMap((c) => (c.parents.length > 1 ? [c.hash] : []))),
);
/** HEAD 包含的提交（Current Branch 高亮）。 */
const inHead = computed(() => headReach(skeleton.value, headBases.value));
/** 开着的高亮，存进 `viewState`；没存过时全开。 */
const highlights = ref<ReadonlySet<Highlight>>(restoreHighlights(viewState.read("highlights")));

/** 骨架的排序（Graph Options），存进 `viewState`；换了就重取骨架（同换分支过滤，选中留着、视图不跳）。 */
const order = ref(restoreOrder(viewState.read("graphOrder")));
const graphOptions = computed(() =>
  graphOptionsMenu(order.value, (next) => {
    order.value = next;
    viewState.write("graphOrder", saveOrder(next));
  }),
);
watch(order, () => {
  if (repo.value !== undefined) void load(repo.value);
});

/** View Options：一节标题加三个勾选项，勾一下马上生效、存起来，选单不收起。 */
const viewOptions = computed((): PopupItem[] => [
  { kind: PopupItemKind.Separator, label: "Highlight" },
  ...HIGHLIGHT_MENU.map(
    (entry): PopupItem => ({
      kind: PopupItemKind.Toggle,
      label: entry.label,
      checked: highlights.value.has(entry.highlight),
      toggle: (on) => setHighlight(entry.highlight, on),
    }),
  ),
]);

function setHighlight(highlight: Highlight, on: boolean): void {
  const next = new Set(highlights.value);
  if (on) next.add(highlight);
  else next.delete(highlight);
  highlights.value = next;
  viewState.write("highlights", saveHighlights(next));
}
const rewordableCommits = computed(() =>
  rewordable(skeleton.value, refs.value.find((ref) => ref.kind === RefKind.Head)?.target),
);

/** 搜索框里正显示的字。改了立刻显示，停 300 毫秒才变成过滤条件（查询要防抖）。 */
const searchText = ref(filter.value.text ?? "");
const SEARCH_DELAY_MS = 300;
let searchTimer: ReturnType<typeof setTimeout> | undefined;
onUnmounted(() => clearTimeout(searchTimer));

function onSearch(text: string): void {
  searchText.value = text;
  clearTimeout(searchTimer);
  const { text: _, ...rest } = filter.value;
  // 清空不用等：立刻恢复。
  if (text === "") {
    setFilter(rest);
    return;
  }
  searchTimer = setTimeout(() => setFilter({ ...rest, text }), SEARCH_DELAY_MS);
}

const DATE_RANGES: readonly DateRange[] = [DateRange.Day, DateRange.Week, DateRange.Month];

function dateLabel(range: DateRange): string {
  switch (range) {
    case DateRange.Day:
      return "Last 24 Hours";
    case DateRange.Week:
      return "Last 7 Days";
    case DateRange.Month:
      return "Last Month";
    default:
      return assertNever(range, "dateLabel");
  }
}

/** 过滤栏按钮上显示的值。 */
const filterValues = computed(() => {
  const values: Partial<Record<FilterKind, string>> = {};
  const { branch, date, author, path } = filter.value;
  if (branch !== undefined) values[FilterKind.Branch] = branch.name;
  if (author !== undefined) values[FilterKind.User] = author.me ? "Me" : author.name;
  if (date !== undefined) values[FilterKind.Date] = dateLabel(date);
  // 只写最后一段，按钮不被长路径撑开。
  if (path !== undefined) values[FilterKind.Paths] = path.slice(path.lastIndexOf("/") + 1);
  return values;
});

function setFilter(next: LogFilter): void {
  filter.value = next;
  viewState.write("logFilter", saveFilter(next));
}

/** 点了过滤栏的按钮：弹原生选择框选一个值。 */
async function openFilter(kind: FilterKind): Promise<void> {
  try {
    switch (kind) {
      case FilterKind.Date: {
        const index = await props.client.request("pick", {
          title: "Filter by Date",
          items: DATE_RANGES.map(dateLabel),
        });
        const date = index === null ? undefined : DATE_RANGES[index];
        if (date !== undefined) setFilter({ ...filter.value, date });
        return;
      }
      case FilterKind.User: {
        if (repo.value === undefined) return;
        const author = await props.client.request("pickAuthor", {
          repo: repo.value,
          hashes: skeleton.value.map((commit) => commit.hash),
        });
        if (author !== null) setFilter({ ...filter.value, author });
        return;
      }
      case FilterKind.Paths: {
        if (repo.value === undefined) return;
        const path = await props.client.request("pickPath", { repo: repo.value });
        if (path !== null) setFilter({ ...filter.value, path });
        return;
      }
      case FilterKind.Branch: {
        const branches = branchFilters(refs.value);
        const index = await props.client.request("pick", {
          title: "Filter by Branch",
          items: branches.map((branch) => branch.name),
        });
        const branch = index === null ? undefined : branches[index];
        if (branch !== undefined) setFilter({ ...filter.value, branch });
        return;
      }
      default:
        return assertNever(kind, "openFilter");
    }
  } catch (cause) {
    report(cause);
  }
}

function clearFilter(kind: FilterKind): void {
  switch (kind) {
    case FilterKind.Date: {
      const { date: _, ...rest } = filter.value;
      setFilter(rest);
      return;
    }
    case FilterKind.User: {
      const { author: _, ...rest } = filter.value;
      setFilter(rest);
      return;
    }
    case FilterKind.Paths: {
      const { path: _, ...rest } = filter.value;
      setFilter(rest);
      return;
    }
    case FilterKind.Branch: {
      const { branch: _, ...rest } = filter.value;
      setFilter(rest);
      return;
    }
    default:
      assertNever(kind, "clearFilter");
  }
}

/** 按分支过滤换的是骨架的起点：分支变了就重取骨架（其余条件在新骨架上重查）。 */
watch(
  () => filter.value.branch?.ref,
  () => {
    if (repo.value !== undefined) void load(repo.value);
  },
);

/** 光标所在行的行号；光标不在列表里时是 -1。刷新、过滤后靠它让视图不跳。 */
function cursorRow(): number {
  const { cursor } = selection.value;
  return cursor === undefined ? -1 : hashes.value.indexOf(cursor);
}

/**
 * 生效的过滤条件变了：原来选中的提交还在的留着、滚到光标那行，一条都不剩就清空选中。
 * 搜索框那一项看结果回来的时刻，不看敲字的时刻。只看条件的变化；骨架刷新后的选中由 `load` 管。
 */
watch(
  [
    () => filter.value.date,
    () => matches.value.text,
    () => matches.value.author,
    () => matches.value.path,
  ],
  async () => {
  await nextTick();
  selection.value = retain(selection.value, hashes.value);
  if (selection.value.ids.size > 0) {
    const row = cursorRow();
    if (row !== -1) list.value?.reveal(row);
    return;
  }
  list.value?.reveal(0);
  },
);

/** 可见范围变了：把范围前后还没有详情的提交取回来。 */
async function fetchVisible(range: RowRange): Promise<void> {
  if (repo.value === undefined) return;
  const known = new Set([...details.value.keys(), ...inFlight]);
  const wanted = hashesToFetch(hashes.value, range, known);
  if (wanted.length === 0) return;
  for (const hash of wanted) inFlight.add(hash);
  try {
    const commits = await props.client.request("getCommitDetails", {
      repo: repo.value,
      hashes: wanted,
    });
    for (const commit of commits) details.value.set(commit.hash, commit);
  } catch (cause) {
    report(cause);
  } finally {
    for (const hash of wanted) inFlight.delete(hash);
  }
}

/** 选中变成恰好一条（且换了一条）时取它的文件；选中多条或没有选中时清空。 */
watch(selected, async (hash) => {
  files.value = [];
  filesLoading.value = false;
  if (hash === undefined || repo.value === undefined) return;
  filesLoading.value = true;
  try {
    const fetched = await props.client.request("getCommitFiles", { repo: repo.value, hash });
    // 取的时候又选了别的提交：这份结果已经过时，丢掉。
    if (selected.value === hash) files.value = fetched;
  } catch (cause) {
    report(cause);
  } finally {
    if (selected.value === hash) filesLoading.value = false;
  }
});

/**
 * 拉骨架与 refs。首次打开、以及 refs 变了之后都走这里。
 *
 * 选中的提交还有留在列表里的：留着，光标那行停在屏幕上原来的位置（上方多了新提交时视图不跳）。
 * 一条都不剩（或首次打开）：改选 HEAD 所在的提交并滚过去——列表第一行不一定是 HEAD。
 */
async function load(repository: string): Promise<void> {
  try {
    // 先 refs 后骨架：按分支过滤时骨架从那个分支往下走，分支在不在只有 refs 回答。
    // 同时发的话，分支已被删掉（在这里删、在外面删、fetch 时 prune、存下的过滤在重开窗口时已不在）
    // 骨架那条必然失败，连带 refs 也用不上。
    const fetchedRefs = await props.client.request("getRefs", { repo: repository });
    // 正在过滤的分支没了：过滤落空，清掉它。改过滤会触发按全部分支重取，这里不再往下走。
    const filtered = filter.value.branch;
    if (filtered !== undefined && !branchFilters(fetchedRefs).some((b) => b.ref === filtered.ref)) {
      const { branch: _, ...rest } = filter.value;
      setFilter(rest);
      return;
    }
    const params =
      filtered === undefined ? { repo: repository } : { repo: repository, branch: filtered.ref };
    const [fetchedSkeleton, fetchedBases, fetchedMe] = await Promise.all([
      props.client.request("getSkeleton", { ...params, order: order.value }),
      props.client.request("getHeadBases", params),
      props.client.request("getIdentity", { repo: repository }),
    ]);
    const previous = cursorRow();
    // 内容没变就沿用旧数组：refs 变了而提交没变（fetch 没拉到新东西、切到同一提交上的分支）时，
    // 图结构不重算、筛选不重查。
    // 骨架、refs 取齐了一起换：图的结构与颜色两者任一变了都要重算，分开换就算两遍。
    skeleton.value = keepIfSame(skeleton.value, fetchedSkeleton, sameCommit);
    refs.value = fetchedRefs;
    headBases.value = keepIfSame(headBases.value, fetchedBases);
    if (fetchedMe?.name !== me.value?.name || fetchedMe?.email !== me.value?.email) {
      me.value = fetchedMe;
    }
    loaded.value = true;
    await nextTick();

    selection.value = retain(selection.value, hashes.value);
    if (selection.value.ids.size > 0) {
      const kept = cursorRow();
      if (previous !== -1 && kept !== -1) list.value?.shift(previous, kept);
      return;
    }
    const head = fetchedRefs.find((r) => r.kind === RefKind.Head)?.target;
    const row = head === undefined ? -1 : hashes.value.indexOf(head);
    if (head === undefined || row === -1) return;
    list.value?.reveal(row);
    selection.value = selectOnly(head);
  } catch (cause) {
    report(cause);
  }
}

/**
 * 分支树的选中（两种看法）。竖按钮 New Branch、Update、Delete 用和右键菜单同一份定义（`branchTree.ts`）算：
 * 算不出就置灰，算出来的就是请求的参数。
 */
const branchSelection = ref<MenuViews<BranchNode>>({ exact: [], expanded: [] });
const newBranchArgs = computed(() => NEW_BRANCH.evaluate(branchSelection.value));
const updateArgs = computed(() => UPDATE_BRANCH.evaluate(branchSelection.value));
const deleteArgs = computed(() => DELETE_BRANCHES.evaluate(branchSelection.value));

/**
 * 分支树左边竖按钮区的 Fetch：取全部远程。进度与完成消息由扩展侧显示在状态栏；
 * 按钮本身不转圈、不置灰——连点只是在远程道里排队。
 */
async function fetchRemotes(): Promise<void> {
  if (repo.value === undefined) return;
  try {
    await props.client.request("fetch", { repo: repo.value });
  } catch (cause) {
    report(cause);
  }
}

/** Update Selected：只取选中分支跟踪的远程分支，能快进就快进，分叉时扩展问变基还是合并。 */
async function updateSelected(): Promise<void> {
  const args = updateArgs.value;
  if (repo.value === undefined || args === undefined) return;
  try {
    await props.client.request("update", { repo: repo.value, ...args });
  } catch (cause) {
    report(cause);
  }
}

/** Delete Selected：与右键菜单的 Delete 同一条请求，确认由扩展问。 */
async function deleteSelected(): Promise<void> {
  const args = deleteArgs.value;
  if (repo.value === undefined || args === undefined) return;
  try {
    await props.client.request("deleteBranches", { repo: repo.value, ...args });
  } catch (cause) {
    report(cause);
  }
}

/** New Branch from Selected：名字由扩展弹输入框问，与右键菜单的 New Branch from Here… 同一条命令。 */
async function newBranchFromSelected(): Promise<void> {
  const args = newBranchArgs.value;
  if (repo.value === undefined || args === undefined) return;
  try {
    await props.client.request("newBranch", { repo: repo.value, ...args });
  } catch (cause) {
    report(cause);
  }
}

function onCopy(text: string): void {
  void copyText(props.client, text);
}

/**
 * 提交列表上的复制快捷键：选中的提交一条一行（`commitCopyText`）。
 * 看得见的行一般早已取到详情；Ctrl+A 选上的、滚出去的没取到，一次补齐（走 stdin，条数不受命令行长度限制）。
 */
async function copyCommits(hashes: readonly string[]): Promise<void> {
  if (repo.value === undefined) return;
  try {
    const missing = hashes.filter((hash) => !details.value.has(hash));
    if (missing.length > 0) {
      const fetched = await props.client.request("getCommitDetails", {
        repo: repo.value,
        hashes: missing,
      });
      for (const commit of fetched) details.value.set(commit.hash, commit);
    }
    const commits = hashes.flatMap((hash) => {
      const commit = details.value.get(hash);
      return commit === undefined ? [] : [commit];
    });
    if (commits.length > 0) await copyText(props.client, commitCopyText(commits));
  } catch (cause) {
    report(cause);
  }
}

/** 右栏的文件：双击或回车打开，单击或上下键跟随（由 `mode` 区分）。 */
async function openFile({ entry }: FileRow, mode: DiffOpenMode): Promise<void> {
  const commit = selected.value === undefined ? undefined : details.value.get(selected.value);
  const file = files.value.find((change) => change.path === entry.path);
  if (repo.value === undefined || commit === undefined || file === undefined) return;
  const { left, right } = commitDiffSides(commit.hash, commit.parents, file);
  await props.client.request("openDiff", {
    repo: repo.value,
    left,
    right,
    mode,
  });
}

onMounted(async () => {
  // 先握手，再问有哪些仓库，拿到第一个就开始拉。
  // 扩展侧在收到 ready 之前一个字节都不发，所以不存在「发早了被丢掉」。
  props.client.start();
  try {
    const roots = await props.client.request("getRepositories", {});
    const first = roots[0];
    if (first === undefined) return;
    repo.value = first;
    // **只在 refs 变了才重拉提交列表。** 保存一次工作区文件只会得到 worktree，
    // 不该触发提交列表重算。
    props.client.onDomainsChanged((_changed, domains) => {
      if (domains.includes(GitDomain.Refs)) void load(first);
    });
    await load(first);
  } catch (cause) {
    report(cause);
  }
});

/**
 * 三栏宽度（像素）与右栏上下的比例。从 `viewState` 取回（重新加载窗口也在），拖动时存回去。
 * 尺寸只记在这一处，分隔线的位置都从它摆（见下面的 `resizes`）。
 */
let layout: Layout = restoreLayout(viewState.read("layout"));
const outerSplit = ref<VscodeSplitLayout>();
const innerSplit = ref<VscodeSplitLayout>();
const detailsSplit = ref<VscodeSplitLayout>();

function onLeftSplit(event: Event): void {
  const position = splitPosition(event);
  if (position === undefined) return;
  layout = { ...layout, left: position };
  viewState.write("layout", layout);
}

/** 内层分隔线的位置从左边算起；右栏宽度 = 内层当时的实际宽度 − 分隔线位置。 */
function onRightSplit(event: Event): void {
  const position = splitPosition(event);
  if (position === undefined || innerSplit.value === undefined) return;
  const width = innerSplit.value.getBoundingClientRect().width;
  layout = { ...layout, right: width - position };
  viewState.write("layout", layout);
}

/** 右栏上下的分隔线：存文件占的百分比，详情占其余。 */
function onDetailsSplit(event: Event): void {
  const percent = splitPercent(event);
  if (percent === undefined) return;
  layout = { ...layout, files: percent };
  viewState.write("layout", layout);
}

/**
 * 每层的尺寸一变，就从 `layout` 重摆这一层的分隔线：窗口或面板变大变小时，左右两栏保持像素宽度、
 * 右栏上下保持比例，多出来的都给中间的提交列表。
 *
 * 不用组件的 `fixed-pane`：它自己另记一份固定栏的宽度。面板收起时页面还在、只是缩成 0，
 * 它就把那份记成 0，再展开时那一栏没了。`layout` 只在拖动时写，收起、窗口变窄都碰不到它。
 *
 * 只摆尺寸变了的那层：拖左边的分隔线时内层跟着变宽变窄，这时连外层一起重摆，会把正在拖的分隔线拽回去。
 * 内层的位置只能从左边算，所以是「宽度 − 右栏宽度」；比右栏还窄时组件自己压到 0。
 * 摆的时候设 `handlePosition`，它会先重新量这一层的尺寸，之后按下分隔线才不跳位。
 * 不能用 `resetHandlePosition()`：它只重算位置、不更新尺寸，比例会越拉越歪。
 */
const resizes = new ResizeObserver((entries) => {
  for (const { target, contentRect } of entries) {
    const outer = outerSplit.value;
    const inner = innerSplit.value;
    const vertical = detailsSplit.value;
    if (target === outer) outer.handlePosition = `${layout.left}px`;
    if (target === inner) inner.handlePosition = `${contentRect.width - layout.right}px`;
    if (target === vertical) vertical.handlePosition = `${layout.files}%`;
  }
});
onMounted(async () => {
  for (const split of [outerSplit.value, innerSplit.value, detailsSplit.value]) {
    if (split === undefined) continue;
    await split.updateComplete;
    resizes.observe(split);
  }
});
onUnmounted(() => resizes.disconnect());
</script>

<template>
  <vscode-split-layout
    class="layout"
    split="vertical"
    ref="outerSplit"
    :initial-handle-position="`${layout.left}px`"
    @vsc-split-layout-change="onLeftSplit"
  >
    <div slot="start" class="branches">
      <div class="sync-bar">
        <ToolButton
          :icon="codicon('add')"
          title="New Branch from Selected"
          :disabled="newBranchArgs === undefined"
          @click="newBranchFromSelected"
        />
        <ToolButton
          :icon="appIcon(AppIcon.Pull)"
          title="Update Selected"
          :disabled="updateArgs === undefined"
          @click="updateSelected"
        />
        <ToolButton
          :icon="codicon('trash')"
          title="Delete Selected"
          :disabled="deleteArgs === undefined"
          @click="deleteSelected"
        />
        <ToolButton :icon="appIcon(AppIcon.Fetch)" title="Fetch" @click="fetchRemotes" />
        <span class="sync-gap" />
        <ToolButton
          :icon="appIcon(AppIcon.ExpandAll)"
          title="Expand All"
          :disabled="refs.length === 0"
          @click="branchTree?.expandAll()"
        />
        <ToolButton
          :icon="appIcon(AppIcon.CollapseAll)"
          title="Collapse All"
          :disabled="refs.length === 0"
          @click="branchTree?.collapseAll()"
        />
      </div>
      <div class="pane">
        <BranchTree
          ref="branchTree"
          :refs="refs"
          :repo="repo ?? ''"
          @select="(views) => (branchSelection = views)"
          @filter="(branch) => setFilter({ ...filter, branch })"
          @copy="onCopy"
        />
      </div>
    </div>

    <vscode-split-layout
      slot="end"
      split="vertical"
      ref="innerSplit"
      @vsc-split-layout-change="onRightSplit"
    >
      <div slot="start" class="pane">
        <FilterBar
          :values="filterValues"
          :text="searchText"
          :graph-options="graphOptions"
          :view-options="viewOptions"
          @search="onSearch"
          @open="openFilter"
          @clear="clearFilter"
        />
        <p v-if="!loaded" class="dim loading">Loading…</p>
        <p v-else-if="isFiltering(filter) && hashes.length === 0" class="dim loading">
          No commits match the filters
        </p>
        <CommitList
          v-else
          ref="list"
          :hashes="hashes"
          :details="details"
          v-model:selection="selection"
          :now="now"
          :repo="repo"
          :graph="graph"
          :labels="labels"
          :rewordable="rewordableCommits"
          :merges="merges"
          :in-head="inHead"
          :me="me"
          :highlights="highlights"
          @copy="copyCommits"
          @visible="fetchVisible"
        />
      </div>

      <vscode-split-layout
        slot="end"
        split="horizontal"
        ref="detailsSplit"
        @vsc-split-layout-change="onDetailsSplit"
      >
        <div slot="start" class="pane">
          <p v-if="selection.ids.size > 1" class="dim loading">{{ selection.ids.size }} commits selected</p>
          <p v-else-if="filesLoading" class="dim loading">Loading…</p>
          <FileTree v-else :groups="fileGroups" @open="openFile" @copy="onCopy" />
        </div>
        <div slot="end" class="details">
          <template v-if="selectedDetails !== undefined">
            <p v-if="selectedDetails.subject !== ''" class="subject">{{ selectedDetails.subject }}</p>
            <p v-if="selectedDetails.body !== ''" class="body">{{ selectedDetails.body }}</p>
            <p class="meta">
              <span class="hash">{{ selectedDetails.hash }}</span>{{ selectedDetails.author }}
            </p>
            <p v-if="selectedDetails.committer !== undefined" class="meta dim">
              {{ selectedDetails.committer }}
            </p>
          </template>
        </div>
      </vscode-split-layout>
    </vscode-split-layout>
  </vscode-split-layout>
</template>

<style scoped>
/* 分支树左边的竖按钮区。 */
.branches {
  display: flex;
  height: 100%;
}
/* 展开 / 收起只管看，和上面那几个动分支的按钮隔开一点。 */
.sync-gap {
  height: 6px;
}
.sync-bar {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 4px 2px;
  border-right: 1px solid var(--vscode-panel-border);
}
.branches > .pane {
  flex: 1;
  min-width: 0;
}
/* 提交详情：文字可以选中复制。说明照原样排，保留换行；长单词（URL、路径）在任意处折行。 */
.details {
  height: 100%;
  overflow: auto;
  box-sizing: border-box;
  padding: 8px 12px;
  border-top: 1px solid var(--vscode-panel-border);
  user-select: text;
}
.details p {
  margin: 0 0 8px;
  overflow-wrap: anywhere;
}
.subject,
.body {
  white-space: pre-wrap;
}
.subject {
  font-weight: bold;
}
.hash {
  margin-right: 8px;
  font-family: var(--vscode-editor-font-family);
}
</style>
