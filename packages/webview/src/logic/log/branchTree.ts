import {
  assertNever,
  MenuContextKey,
  type Ref,
  RefKind,
  type Upstream,
  UpstreamState,
} from "@dummy-git/shared";
import { codicon } from "../icons.js";
import {
  exactlyOne,
  type MenuArgs,
  type MenuItem,
  MenuView,
  type MenuViews,
  menuItem,
  menuItemsContext,
} from "../menuItems.js";
import type { TreeNode } from "../tree/tree.js";
import type { BranchFilter } from "./filter.js";

/**
 * 左栏分支树：由 `getRefs` 的结果整理而来。
 *
 * 顶上一行 HEAD；「Local」「Remote」两组；Remote 先按远程名分，再按 `/` 折叠成目录，
 * Local 同样按 `/` 折叠。每层按名字排序，目录在前。
 */
export enum BranchNodeKind {
  Head = "head",
  Group = "group",
  Folder = "folder",
  /** Remote 组下面的远程名（`origin`）：本身是一个远程，删分支时它和目录一样只是归类。 */
  Remote = "remote",
  Branch = "branch",
}

/** 分支树里的一个分支对应的引用：本地分支或远程分支。 */
type BranchRef = Extract<Ref, { kind: RefKind.LocalBranch | RefKind.RemoteBranch }>;

export type BranchNode =
  | {
      readonly kind: BranchNodeKind.Head;
      readonly id: string;
      readonly label: string;
      /** HEAD 指向的提交。 */
      readonly target: string;
      /** HEAD 所在的本地分支；detached 时缺席。 */
      readonly branch?: string;
      /** 那个本地分支的上游（Update 要用）；detached、没配上游时缺席。 */
      readonly upstream?: Upstream;
    }
  | {
      readonly kind: BranchNodeKind.Group | BranchNodeKind.Folder;
      /** 展开状态按它记。同一层级结构下稳定：`local`、`remote/origin/feat`。 */
      readonly id: string;
      readonly label: string;
      readonly children: readonly BranchNode[];
    }
  | {
      readonly kind: BranchNodeKind.Remote;
      readonly id: string;
      readonly label: string;
      /** 远程名。 */
      readonly remote: string;
      readonly children: readonly BranchNode[];
    }
  | {
      readonly kind: BranchNodeKind.Branch;
      readonly id: string;
      /** 最后一段名字，比如 `feat/x` 显示 `x`。 */
      readonly label: string;
      /** HEAD 当前所在的分支。 */
      readonly current: boolean;
      readonly ref: BranchRef;
    };

const HEAD_ID = "head";
const LOCAL_ID = "local";
const REMOTE_ID = "remote";

export function buildBranchTree(refs: readonly Ref[]): readonly BranchNode[] {
  let head: Extract<Ref, { kind: RefKind.Head }> | undefined;
  const local: Leaf[] = [];
  const remotes = new Map<string, Leaf[]>();

  for (const ref of refs) {
    switch (ref.kind) {
      case RefKind.Head:
        head = ref;
        break;
      case RefKind.LocalBranch:
        local.push({ path: ref.name, ref });
        break;
      case RefKind.RemoteBranch:
        // `origin/HEAD` 只是指向远程默认分支的指针，不是一个分支。
        if (ref.name !== "HEAD")
          remotes.set(ref.remote, [...(remotes.get(ref.remote) ?? []), { path: ref.name, ref }]);
        break;
      case RefKind.Tag:
        break;
      default:
        assertNever(ref, "buildBranchTree");
    }
  }

  const current = head?.branch;
  const nodes: BranchNode[] = [];
  if (head !== undefined) {
    nodes.push(
      head.branch === undefined
        ? {
            kind: BranchNodeKind.Head,
            id: HEAD_ID,
            label: `HEAD (detached at ${head.target.slice(0, 7)})`,
            target: head.target,
          }
        : {
            kind: BranchNodeKind.Head,
            id: HEAD_ID,
            label: `HEAD → ${head.branch}`,
            target: head.target,
            branch: head.branch,
            ...upstreamOf(local, head.branch),
          },
    );
  }
  nodes.push({
    kind: BranchNodeKind.Group,
    id: LOCAL_ID,
    label: "Local",
    children: folderize(LOCAL_ID, local, current),
  });
  nodes.push({
    kind: BranchNodeKind.Group,
    id: REMOTE_ID,
    label: "Remote",
    children: [...remotes.keys()].sort(byName).map(
      (remote): BranchNode => ({
        kind: BranchNodeKind.Remote,
        id: `${REMOTE_ID}/${remote}`,
        label: remote,
        remote,
        children: folderize(`${REMOTE_ID}/${remote}`, remotes.get(remote) ?? [], undefined),
      }),
    ),
  });
  return nodes;
}

/** 当前分支的上游，摊进 HEAD 那行；没配上游时什么都不摊。 */
function upstreamOf(local: readonly Leaf[], branch: string): { readonly upstream?: Upstream } {
  const ref = local.find(
    (leaf) => leaf.ref.kind === RefKind.LocalBranch && leaf.ref.name === branch,
  )?.ref;
  return ref?.kind === RefKind.LocalBranch && ref.upstream !== undefined
    ? { upstream: ref.upstream }
    : {};
}

/** 待折叠的一个分支：`path` 是还没折进目录的那部分名字，`ref` 是它对应的引用。 */
interface Leaf {
  readonly path: string;
  readonly ref: BranchRef;
}

/** 一组分支按 `/` 折叠成目录。`current` 是要标出的当前分支全名（只在 Local 里有）。 */
function folderize(
  parentId: string,
  leaves: readonly Leaf[],
  current: string | undefined,
  prefix = "",
): readonly BranchNode[] {
  const folders = new Map<string, Leaf[]>();
  const here: Leaf[] = [];
  for (const leaf of leaves) {
    const slash = leaf.path.indexOf("/");
    if (slash === -1) {
      here.push(leaf);
    } else {
      const folder = leaf.path.slice(0, slash);
      const rest = { path: leaf.path.slice(slash + 1), ref: leaf.ref };
      folders.set(folder, [...(folders.get(folder) ?? []), rest]);
    }
  }
  return [
    ...[...folders.keys()].sort(byName).map(
      (folder): BranchNode => ({
        kind: BranchNodeKind.Folder,
        id: `${parentId}/${folder}`,
        label: folder,
        children: folderize(
          `${parentId}/${folder}`,
          folders.get(folder) ?? [],
          current,
          `${prefix}${folder}/`,
        ),
      }),
    ),
    ...here
      .sort((a, b) => byName(a.path, b.path))
      .map(
        (leaf): BranchNode => ({
          kind: BranchNodeKind.Branch,
          id: `${parentId}/${leaf.path}`,
          label: leaf.path,
          current: `${prefix}${leaf.path}` === current,
          ref: leaf.ref,
        }),
      ),
  ];
}

function byName(a: string, b: string): number {
  return a.localeCompare(b);
}

/**
 * 默认展开哪些节点：两组、各远程名，以及当前分支所在的每一层目录——
 * 否则当前分支叫 `feat/x` 时，打开就被折起来看不见。其余 `/` 目录默认折叠。
 */
export function defaultExpanded(nodes: readonly BranchNode[]): ReadonlySet<string> {
  const open = new Set<string>([LOCAL_ID, REMOTE_ID]);
  const visit = (node: BranchNode, ancestors: readonly string[]): void => {
    switch (node.kind) {
      case BranchNodeKind.Head:
        return;
      case BranchNodeKind.Branch:
        if (node.current) for (const id of ancestors) open.add(id);
        return;
      case BranchNodeKind.Group:
      case BranchNodeKind.Folder:
      case BranchNodeKind.Remote:
        for (const child of node.children) visit(child, [...ancestors, node.id]);
        return;
      default:
        assertNever(node, "defaultExpanded");
    }
  };
  for (const node of nodes) {
    visit(node, []);
    if (node.kind === BranchNodeKind.Group && node.id === REMOTE_ID) {
      for (const remote of node.children) open.add(remote.id);
    }
  }
  return open;
}

/** 取回上次存的展开状态（id 列表）。没有或格式不对返回 `undefined`，由调用方用默认值。 */
export function restoreExpanded(saved: unknown): ReadonlySet<string> | undefined {
  if (!Array.isArray(saved) || !saved.every((id) => typeof id === "string")) return undefined;
  return new Set(saved);
}

/**
 * 分支树 → 基础树的节点。图标是 codicon：HEAD 靶心、两组各自的图标、目录文件夹、分支图标；
 * 当前分支用主题的图表黄标签、文字加粗，比对勾醒目，跟着主题走不写死颜色。
 */
export function toTreeNodes(nodes: readonly BranchNode[]): TreeNode[] {
  return nodes.map((node): TreeNode => {
    switch (node.kind) {
      case BranchNodeKind.Head:
        return { id: node.id, label: node.label, icon: codicon("target") };
      case BranchNodeKind.Group:
        return {
          id: node.id,
          label: node.label,
          icon: codicon(node.id === LOCAL_ID ? "device-desktop" : "cloud"),
          children: toTreeNodes(node.children),
        };
      case BranchNodeKind.Folder:
      case BranchNodeKind.Remote:
        return {
          id: node.id,
          label: node.label,
          icon: codicon("folder"),
          openedIcon: codicon("folder-opened"),
          children: toTreeNodes(node.children),
        };
      case BranchNodeKind.Branch:
        return node.current
          ? {
              id: node.id,
              label: node.label,
              bold: true,
              icon: codicon("tag"),
              iconColor: "var(--vscode-charts-yellow)",
            }
          : { id: node.id, label: node.label, icon: codicon("git-branch") };
      default:
        return assertNever(node, "toTreeNodes");
    }
  });
}

export enum DeleteTargetKind {
  Local = "local",
  Remote = "remote",
}

/** 左栏 Delete 按钮删的是什么。 */
export type DeleteTarget =
  | { readonly kind: DeleteTargetKind.Local; readonly branch: string }
  | { readonly kind: DeleteTargetKind.Remote; readonly remote: string; readonly branch: string };

/**
 * 选中的节点能不能删，能就给出删什么。与右键菜单同一规则：非当前的本地分支、远程分支。
 * HEAD 那行、当前分支、目录、分组都不能。
 */
export function deleteTargetOf(node: BranchNode): DeleteTarget | undefined {
  switch (node.kind) {
    case BranchNodeKind.Branch:
      if (node.ref.kind === RefKind.RemoteBranch) {
        return { kind: DeleteTargetKind.Remote, remote: node.ref.remote, branch: node.ref.name };
      }
      return node.current ? undefined : { kind: DeleteTargetKind.Local, branch: node.ref.name };
    case BranchNodeKind.Head:
    case BranchNodeKind.Group:
    case BranchNodeKind.Folder:
    case BranchNodeKind.Remote:
      return undefined;
    default:
      return assertNever(node, "deleteTargetOf");
  }
}

/**
 * 双击按分支过滤：这个节点代表哪个分支（完整引用名与显示名）。
 * HEAD 那行代表当前分支；detached 的 HEAD、目录、分组不是分支，返回 `undefined`。
 */
export function branchFilterOf(node: BranchNode): BranchFilter | undefined {
  switch (node.kind) {
    case BranchNodeKind.Head:
      return node.branch === undefined
        ? undefined
        : { ref: `refs/heads/${node.branch}`, name: node.branch };
    case BranchNodeKind.Branch: {
      const { start, name } = pointOf(node);
      return { ref: start, name };
    }
    case BranchNodeKind.Group:
    case BranchNodeKind.Folder:
    case BranchNodeKind.Remote:
      return undefined;
    default:
      return assertNever(node, "branchFilterOf");
  }
}

/**
 * 能按它过滤的全部分支（Branch 按钮的列表，也用来判断过滤的分支还在不在）：本地在前、远程在后，各按名字排。
 * 不含 `origin/HEAD`（同分支树）。
 */
export function branchFilters(refs: readonly Ref[]): BranchFilter[] {
  const local: BranchFilter[] = [];
  const remote: BranchFilter[] = [];
  for (const ref of refs) {
    if (ref.kind === RefKind.LocalBranch) {
      local.push({ ref: `refs/heads/${ref.name}`, name: ref.name });
    } else if (ref.kind === RefKind.RemoteBranch && ref.name !== "HEAD") {
      const name = `${ref.remote}/${ref.name}`;
      remote.push({ ref: `refs/remotes/${name}`, name });
    }
  }
  const byName = (a: BranchFilter, b: BranchFilter) => a.name.localeCompare(b.name);
  return [...local.sort(byName), ...remote.sort(byName)];
}

/** 节点 id → 节点。基础树只告诉我们选中了哪个 id。 */
export function branchNodesById(nodes: readonly BranchNode[]): ReadonlyMap<string, BranchNode> {
  const index = new Map<string, BranchNode>();
  const visit = (node: BranchNode): void => {
    index.set(node.id, node);
    if (
      node.kind === BranchNodeKind.Group ||
      node.kind === BranchNodeKind.Folder ||
      node.kind === BranchNodeKind.Remote
    ) {
      for (const child of node.children) visit(child);
    }
  };
  for (const node of nodes) visit(node);
  return index;
}

export enum TrackingKind {
  /** 领先 / 落后，至少一边不为 0。 */
  Counts = "counts",
  /** 上游配置还在，但远程分支已被删除。 */
  Gone = "gone",
}

/** 分支名后面要显示的同步状态。 */
export type Tracking =
  | { readonly kind: TrackingKind.Counts; readonly ahead: number; readonly behind: number }
  | { readonly kind: TrackingKind.Gone };

/**
 * 本地分支相对上游的同步状态。
 * 完全同步、没有上游、远程分支、HEAD 那行、目录与分组都不显示，返回 `undefined`。
 * 数字是和本地记录的远程分支比的，Fetch 之后才准。
 */
export function trackingOf(node: BranchNode): Tracking | undefined {
  if (node.kind !== BranchNodeKind.Branch || node.ref.kind !== RefKind.LocalBranch) {
    return undefined;
  }
  const upstream = node.ref.upstream;
  if (upstream === undefined) return undefined;
  switch (upstream.state.kind) {
    case UpstreamState.Gone:
      return { kind: TrackingKind.Gone };
    case UpstreamState.Tracking: {
      const { ahead, behind } = upstream.state;
      return ahead === 0 && behind === 0 ? undefined : { kind: TrackingKind.Counts, ahead, behind };
    }
    default:
      return assertNever(upstream.state, "trackingOf");
  }
}

/** HEAD 那行与分支：能从它建新分支、有右键菜单的节点。 */
type PointNode = Extract<BranchNode, { kind: BranchNodeKind.Head | BranchNodeKind.Branch }>;

/** 从这里建新分支时的起点。 */
export interface StartPoint {
  /** 给 git 的：完整引用名或提交 hash，不让 git 在同名的本地分支与远程分支之间猜。 */
  readonly start: string;
  /** 给人看的。 */
  readonly name: string;
}

/** 选中的节点能不能当新分支的起点，能就给出起点。目录与分组不能。 */
export function startOf(node: BranchNode): StartPoint | undefined {
  switch (node.kind) {
    case BranchNodeKind.Head:
    case BranchNodeKind.Branch:
      return pointOf(node);
    case BranchNodeKind.Group:
    case BranchNodeKind.Folder:
    case BranchNodeKind.Remote:
      return undefined;
    default:
      return assertNever(node, "startOf");
  }
}

function pointOf(node: PointNode): StartPoint {
  if (node.kind === BranchNodeKind.Head) {
    return node.branch === undefined
      ? { start: node.target, name: node.target.slice(0, 7) }
      : { start: `refs/heads/${node.branch}`, name: node.branch };
  }
  const ref = node.ref;
  switch (ref.kind) {
    case RefKind.LocalBranch:
      return { start: `refs/heads/${ref.name}`, name: ref.name };
    case RefKind.RemoteBranch:
      return { start: `refs/remotes/${ref.remote}/${ref.name}`, name: `${ref.remote}/${ref.name}` };
    default:
      return assertNever(ref, "pointOf");
  }
}

/** 本地分支（含 HEAD 那行代表的当前分支）：名字与是不是当前分支。远程分支、detached 的 HEAD、目录、分组不是。 */
function localOf(
  node: BranchNode,
): { readonly branch: string; readonly current: boolean } | undefined {
  switch (node.kind) {
    case BranchNodeKind.Head:
      return node.branch === undefined ? undefined : { branch: node.branch, current: true };
    case BranchNodeKind.Branch:
      return node.ref.kind === RefKind.LocalBranch
        ? { branch: node.ref.name, current: node.current }
        : undefined;
    case BranchNodeKind.Group:
    case BranchNodeKind.Folder:
    case BranchNodeKind.Remote:
      return undefined;
    default:
      return assertNever(node, "localOf");
  }
}

/** 不是当前分支的本地分支的名字：能切过去、能删、能合进来。 */
function otherLocalOf(node: BranchNode): string | undefined {
  const local = localOf(node);
  return local === undefined || local.current ? undefined : local.branch;
}

/** 远程分支：远程名与不带远程名的那段。 */
function remoteOf(
  node: BranchNode,
): { readonly remote: string; readonly branch: string } | undefined {
  return node.kind === BranchNodeKind.Branch && node.ref.kind === RefKind.RemoteBranch
    ? { remote: node.ref.remote, branch: node.ref.name }
    : undefined;
}

/** 起点作为协议参数：New Branch、Merge、Rebase 都收这一对。 */
function startArgs(point: StartPoint): { readonly start: string; readonly startName: string } {
  return { start: point.start, startName: point.name };
}

/** 点中的是远程名或 `Remote` 组：删掉一个远程上的全部分支等于替所有人清空它，不给 Delete。 */
function isRemoteContainer(node: BranchNode): boolean {
  return (
    node.kind === BranchNodeKind.Remote ||
    (node.kind === BranchNodeKind.Group && node.id === REMOTE_ID)
  );
}

/** 能 Update 的本地分支（含当前分支）：配了上游，上游也还在（不是 `gone`）。给出它的名字。 */
function updatableOf(node: BranchNode): string | undefined {
  const local = localOf(node);
  const upstream =
    node.kind === BranchNodeKind.Head
      ? node.upstream
      : node.kind === BranchNodeKind.Branch && node.ref.kind === RefKind.LocalBranch
        ? node.ref.upstream
        : undefined;
  return local === undefined || upstream === undefined || upstream.state.kind === UpstreamState.Gone
    ? undefined
    : local.branch;
}

/**
 * Update：展开看，目录、`Local` 组等于它下面的全部本地分支。每一个都要能更新（`updatableOf`），
 * 否则整项不出现（全部严格）。竖按钮 Update Selected 用同一份。
 * HEAD 那行和当前分支那行是同一个分支，一起选时只算一次。
 */
export const UPDATE_BRANCH = menuItem({
  view: MenuView.Expanded,
  key: MenuContextKey.UpdateBranch,
  pick: (node: BranchNode) => updatableOf(node),
  value: (branches) => ({ branches: [...new Set(branches)] }),
});

/** New Branch：HEAD 那行（含 detached）、所有分支都能当起点。竖按钮 New Branch from Selected 用同一份。 */
export const NEW_BRANCH = menuItem({
  view: MenuView.Exact,
  key: MenuContextKey.NewBranch,
  pick: (node: BranchNode) => startOf(node),
  whole: exactlyOne,
  value: ([point]) => startArgs(point),
});

/**
 * Delete：展开看，目录、分组等于它下面的全部分支。每一个都要能删（不是当前分支的本地分支、远程分支），
 * 否则整项不出现（全部严格）。竖按钮 Delete Selected 用同一份。
 */
export const DELETE_BRANCHES = menuItem({
  view: MenuView.Expanded,
  key: MenuContextKey.DeleteBranches,
  pick: (node: BranchNode) => deleteTargetOf(node),
  whole: (_targets, views) => !views.exact.some(isRemoteContainer),
  value: (targets) => ({
    local: targets.flatMap((t) => (t.kind === DeleteTargetKind.Local ? [t.branch] : [])),
    remote: targets.flatMap((t) =>
      t.kind === DeleteTargetKind.Remote ? [{ remote: t.remote, branch: t.branch }] : [],
    ),
  }),
});

/** 分支树的右键菜单项，顺序无关（菜单里的顺序由 `package.json` 的 `group` 定）。 */
const BRANCH_MENU: readonly MenuItem<BranchNode>[] = [
  menuItem({
    view: MenuView.Exact,
    key: MenuContextKey.Checkout,
    pick: otherLocalOf,
    whole: exactlyOne,
    value: ([branch]) => ({ branch }),
  }),
  menuItem({
    view: MenuView.Exact,
    key: MenuContextKey.CheckoutRemote,
    pick: remoteOf,
    whole: exactlyOne,
    value: ([{ remote, branch }]) => ({ remote, branch }),
  }),
  UPDATE_BRANCH,
  menuItem({
    view: MenuView.Exact,
    key: MenuContextKey.PushBranch,
    pick: (node) => localOf(node)?.branch,
    whole: exactlyOne,
    value: ([branch]) => ({ branch }),
  }),
  // 合进当前分支、把当前分支变基上去：别的本地分支或远程分支，当前分支自己不行。
  menuItem({
    view: MenuView.Exact,
    key: MenuContextKey.MergeBranch,
    pick: (node) =>
      (otherLocalOf(node) ?? remoteOf(node)) === undefined ? undefined : startOf(node),
    whole: exactlyOne,
    value: ([point]) => startArgs(point),
  }),
  menuItem({
    view: MenuView.Exact,
    key: MenuContextKey.RebaseBranch,
    pick: (node) =>
      (otherLocalOf(node) ?? remoteOf(node)) === undefined ? undefined : startOf(node),
    whole: exactlyOne,
    value: ([point]) => startArgs(point),
  }),
  NEW_BRANCH,
  menuItem({
    view: MenuView.Exact,
    key: MenuContextKey.RenameBranch,
    pick: (node) => localOf(node)?.branch,
    whole: exactlyOne,
    value: ([branch]) => ({ branch }),
  }),
  DELETE_BRANCHES,
];

/**
 * 由点中的节点 id 算出两种看法：原样看是这些节点本身；展开看是其中的分支（含 HEAD 那行），
 * 加上点中目录、分组、远程名下面的全部分支，去掉重复。按当前的树算：刷新后新出现在目录里的分支也算，没了的不算。
 */
export function branchViews(
  ids: readonly string[],
  byId: ReadonlyMap<string, BranchNode>,
): MenuViews<BranchNode> {
  const exact = ids.flatMap((id) => {
    const node = byId.get(id);
    return node === undefined ? [] : [node];
  });
  const seen = new Set<string>();
  const expanded: BranchNode[] = [];
  const collect = (node: BranchNode): void => {
    switch (node.kind) {
      case BranchNodeKind.Head:
      case BranchNodeKind.Branch:
        if (!seen.has(node.id)) expanded.push(node);
        seen.add(node.id);
        return;
      case BranchNodeKind.Group:
      case BranchNodeKind.Folder:
      case BranchNodeKind.Remote:
        for (const child of node.children) collect(child);
        return;
      default:
        assertNever(node, "branchViews");
    }
  };
  for (const node of exact) collect(node);
  return { exact, expanded };
}

/** 选中的节点（两种看法）→ 右键菜单上下文：仓库，加上能做的各菜单项的键。 */
export function branchMenuContext(
  views: MenuViews<BranchNode>,
  repo: string,
): Readonly<Record<string, string | MenuArgs>> {
  return { [MenuContextKey.Repo]: repo, ...menuItemsContext(views, BRANCH_MENU) };
}
