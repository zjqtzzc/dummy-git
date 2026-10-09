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
import { type Client, report } from "../logic/client.js";
import { AppIcon, appIcon, codicon } from "../logic/icons.js";
import { branchFilters, type StartPoint } from "../logic/log/branchTree.js";
import { commitDiffSides, commitFileEntry } from "../logic/log/commitDiff.js";
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
import { type Layout, restoreLayout, splitPosition } from "../logic/log/layout.js";
import { hashesToFetch } from "../logic/log/prefetch.js";
import type { FileEntry } from "../logic/tree/fileTree.js";
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
/** 骨架，最多一万条（`ARCHITECTURE.md` 第 8 题）。 */
const skeleton = ref<CommitSkeleton[]>([]);
/** 已经取到的详情。同一个 hash 的内容永远不变，刷新时不清。 */
const details = ref(new Map<string, Commit>());
/** 正在路上的详情请求，避免重复要。不参与界面，不用 ref。 */
const inFlight = new Set<string>();
const loaded = ref(false);
/** 分支、tag 与 HEAD，左栏用。 */
const refs = ref<Ref[]>([]);
const selected = ref<string>();
const files = ref<CommitFileChange[]>([]);
/** 右栏只有一组，没有标题。 */
const fileGroups = computed(() => [{ id: "files", entries: files.value.map(commitFileEntry) }]);
/** 右栏正在取选中提交的文件。 */
const filesLoading = ref(false);
const list = ref<InstanceType<typeof CommitList>>();

/** 「现在」，秒。每 30 秒走一次，「5 minutes ago」才会跟着变。 */
const now = ref(Math.floor(Date.now() / 1000));
const clock = setInterval(() => {
  now.value = Math.floor(Date.now() / 1000);
}, 30_000);
onUnmounted(() => clearInterval(clock));

/** 过滤条件（`.notes/design/phase-5.md`）。存进 `viewState`：重新加载窗口后还在。 */
const filter = ref<LogFilter>(restoreFilter(viewState.read("logFilter")));
/**
 * 一种要问 git 的条件（说明文字、作者）：条件或骨架变了就问一次，只收最新一次的结果（先发的可能后回来）。
 * 骨架变了（仓库有变化）也重查，同一个条件在新的一万条里重新找。结果连同它对应的条件一起存：
 * 回来之前列表照上一次的结果显示，条件清掉时作废。
 */
function useMatch(condition: () => MatchCondition | undefined) {
  const result = ref<{ readonly condition: MatchCondition; readonly hashes: ReadonlySet<string> }>();
  const busy = ref(false);
  let seq = 0;
  // 按内容比：过滤条件整个换了新对象（比如只改了日期）时，这一项没变就不重查。
  watch([() => JSON.stringify(condition() ?? null), skeleton], async () => {
    const mine = ++seq;
    const current = condition();
    if (current === undefined) {
      result.value = undefined;
      busy.value = false;
      return;
    }
    if (repo.value === undefined || skeleton.value.length === 0) return;
    busy.value = true;
    try {
      const found = await props.client.request("matchCommits", {
        repo: repo.value,
        hashes: skeleton.value.map((commit) => commit.hash),
        condition: current,
      });
      if (mine === seq) result.value = { condition: current, hashes: new Set(found) };
    } catch (cause) {
      report(cause);
    } finally {
      if (mine === seq) busy.value = false;
    }
  });
  return { result, busy };
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
/** 正在问 git：过滤栏转圈。 */
const searching = computed(() => byText.busy.value || byAuthor.busy.value || byPath.busy.value);

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
/** 列表里显示的提交：骨架按过滤条件筛过，顺序不变。 */
const hashes = computed(() => applyFilter(skeleton.value, filter.value, now.value, matches.value));

/** 搜索框里正显示的字。改了立刻显示，停 300 毫秒才变成过滤条件（`NFR.md` 第 3 节：查询要防抖）。 */
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

/**
 * 生效的过滤条件变了：原来选中的提交还在就保持选中并滚过去，不在就清空选中（第 9 条）。
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
  const row = selected.value === undefined ? -1 : hashes.value.indexOf(selected.value);
  if (row !== -1) {
    list.value?.reveal(row);
    return;
  }
  selected.value = undefined;
  files.value = [];
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

async function select(hash: string): Promise<void> {
  selected.value = hash;
  files.value = [];
  if (repo.value === undefined) return;
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
}

/**
 * 拉骨架与 refs。首次打开、以及 refs 变了之后都走这里。
 *
 * 选中的提交还在：让它停在屏幕上原来的位置（上方多了新提交时视图不跳）。
 * 不在了（或首次打开）：改选 HEAD 所在的提交并滚过去——列表第一行不一定是 HEAD。
 */
async function load(repository: string): Promise<void> {
  try {
    const branch = filter.value.branch?.ref;
    const [fetchedSkeleton, fetchedRefs] = await Promise.all([
      props.client.request(
        "getSkeleton",
        branch === undefined ? { repo: repository } : { repo: repository, branch },
      ),
      props.client.request("getRefs", { repo: repository }),
    ]);
    const previous = selected.value === undefined ? -1 : hashes.value.indexOf(selected.value);
    skeleton.value = fetchedSkeleton;
    refs.value = fetchedRefs;
    loaded.value = true;
    // 正在过滤的分支被删了（`TRAPS.md`）：过滤落空，按全部分支重取。
    const filtered = filter.value.branch;
    if (filtered !== undefined && !branchFilters(fetchedRefs).some((b) => b.ref === filtered.ref)) {
      const { branch: _, ...rest } = filter.value;
      setFilter(rest);
      return;
    }
    await nextTick();

    const kept = selected.value === undefined ? -1 : hashes.value.indexOf(selected.value);
    if (previous !== -1 && kept !== -1) {
      list.value?.shift(previous, kept);
      return;
    }
    const head = fetchedRefs.find((r) => r.kind === RefKind.Head)?.target;
    const row = head === undefined ? -1 : hashes.value.indexOf(head);
    if (head === undefined || row === -1) return;
    list.value?.reveal(row);
    await select(head);
  } catch (cause) {
    report(cause);
  }
}

/** 分支树里选中的本地分支：Pull / Push 的对象。选中的不是本地分支时两个按钮置灰。 */
const selectedBranch = ref<string>();
/** 分支树里选中节点的起点：New Branch 的起点。选中的是目录、分组或没选时置灰。 */
const selectedStart = ref<StartPoint>();

function onBranchSelect(branch: string | undefined, start: StartPoint | undefined): void {
  selectedBranch.value = branch;
  selectedStart.value = start;
}

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

/** Pull Selected：只更新选中的本地分支和它跟踪的远程分支，只快进。 */
async function pullSelected(): Promise<void> {
  if (repo.value === undefined || selectedBranch.value === undefined) return;
  try {
    await props.client.request("pull", { repo: repo.value, branch: selectedBranch.value });
  } catch (cause) {
    report(cause);
  }
}

/** Push Selected：推到哪里由扩展算（上游 → 唯一的远程 → origin）。 */
async function pushSelected(): Promise<void> {
  if (repo.value === undefined || selectedBranch.value === undefined) return;
  try {
    await props.client.request("push", { repo: repo.value, branch: selectedBranch.value });
  } catch (cause) {
    report(cause);
  }
}

/** New Branch from Selected：名字由扩展弹输入框问，与右键菜单的 New Branch from Here… 同一条命令。 */
async function newBranchFromSelected(): Promise<void> {
  if (repo.value === undefined || selectedStart.value === undefined) return;
  const { start, name } = selectedStart.value;
  try {
    await props.client.request("newBranch", { repo: repo.value, start, startName: name });
  } catch (cause) {
    report(cause);
  }
}

/** 右栏的文件：双击或回车打开，单击或上下键跟随（由 `mode` 区分）。 */
async function openFile(entry: FileEntry, mode: DiffOpenMode): Promise<void> {
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
 * 三栏宽度，像素。从 `viewState` 取回（收起再展开、重新加载窗口都在），拖动时存回去。
 *
 * 外层 `fixed-pane="start"`、内层 `fixed-pane="end"`：窗口或面板大小变化时，
 * 左栏和右栏保持像素宽度，只有中间的提交列表伸缩。设了 fixed-pane，组件才会自己
 * 监听尺寸变化；不设的话它不跟踪宽度，改过尺寸后第一次按下分隔线会跳位。
 */
let layout: Layout = restoreLayout(viewState.read("layout"));
const innerSplit = ref<VscodeSplitLayout>();

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

/**
 * 右栏的初始宽度。组件的分隔线位置只能从左边算，没有「从右边算」的写法，
 * 所以等它自己渲染完、量出内层宽度，一次性把分隔线放到「宽度 − 右栏宽度」。
 * 之后的尺寸变化由 fixed-pane 保持右栏宽度，不再管。
 */
onMounted(async () => {
  const split = innerSplit.value;
  if (split === undefined) return;
  await split.updateComplete;
  const width = split.getBoundingClientRect().width;
  split.initialHandlePosition = `${Math.max(0, width - layout.right)}px`;
  split.resetHandlePosition();
});
</script>

<template>
  <vscode-split-layout
    class="layout"
    split="vertical"
    fixed-pane="start"
    :initial-handle-position="`${layout.left}px`"
    @vsc-split-layout-change="onLeftSplit"
  >
    <div slot="start" class="branches">
      <div class="sync-bar">
        <ToolButton
          :icon="codicon('add')"
          title="New Branch from Selected"
          :disabled="selectedStart === undefined"
          @click="newBranchFromSelected"
        />
        <ToolButton :icon="appIcon(AppIcon.Fetch)" title="Fetch" @click="fetchRemotes" />
        <ToolButton
          :icon="appIcon(AppIcon.Pull)"
          title="Pull Selected"
          :disabled="selectedBranch === undefined"
          @click="pullSelected"
        />
        <ToolButton
          :icon="appIcon(AppIcon.Push)"
          title="Push Selected"
          :disabled="selectedBranch === undefined"
          @click="pushSelected"
        />
      </div>
      <div class="pane">
        <BranchTree
          :refs="refs"
          :repo="repo ?? ''"
          @select="onBranchSelect"
          @filter="(branch) => setFilter({ ...filter, branch })"
        />
      </div>
    </div>

    <vscode-split-layout
      slot="end"
      split="vertical"
      fixed-pane="end"
      ref="innerSplit"
      @vsc-split-layout-change="onRightSplit"
    >
      <div slot="start" class="pane">
        <FilterBar
          :values="filterValues"
          :text="searchText"
          :busy="searching"
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
          :selected="selected"
          :now="now"
          @select="select"
          @visible="fetchVisible"
        />
      </div>

      <div slot="end" class="pane">
        <p v-if="filesLoading" class="dim loading">Loading…</p>
        <FileTree v-else :groups="fileGroups" @open="openFile" />
      </div>
    </vscode-split-layout>
  </vscode-split-layout>
</template>

<style scoped>
/* 分支树左边的竖按钮区（同 IDEA 的 Log 窗口）。 */
.branches {
  display: flex;
  height: 100%;
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
</style>
