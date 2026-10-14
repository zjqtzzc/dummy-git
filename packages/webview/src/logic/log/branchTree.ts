import {
  assertNever,
  MenuContextKey,
  MenuNodeValue,
  type Ref,
  RefKind,
  UpstreamState,
} from "@dummy-git/shared";
import { codicon } from "../icons.js";
import type { TreeNode } from "../tree/tree.js";
import type { BranchFilter } from "./filter.js";

/**
 * 左栏分支树（`.notes/design/phase-1.md` 第 3 条）：由 `getRefs` 的结果整理而来。
 *
 * 顶上一行 HEAD；「Local」「Remote」两组；Remote 先按远程名分，再按 `/` 折叠成目录，
 * Local 同样按 `/` 折叠。每层按名字排序，目录在前。tag 不在第 1 阶段。
 */
export enum BranchNodeKind {
  Head = "head",
  Group = "group",
  Folder = "folder",
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
    }
  | {
      readonly kind: BranchNodeKind.Group | BranchNodeKind.Folder;
      /** 展开状态按它记。同一层级结构下稳定：`local`、`remote/origin/feat`。 */
      readonly id: string;
      readonly label: string;
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
        kind: BranchNodeKind.Folder,
        id: `${REMOTE_ID}/${remote}`,
        label: remote,
        children: folderize(`${REMOTE_ID}/${remote}`, remotes.get(remote) ?? [], undefined),
      }),
    ),
  });
  return nodes;
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
export function toTreeNodes(nodes: readonly BranchNode[], repo: string): TreeNode[] {
  return nodes.map((node): TreeNode => {
    switch (node.kind) {
      case BranchNodeKind.Head:
        return {
          id: node.id,
          label: node.label,
          icon: codicon("target"),
          menu: menuOf(node, repo),
        };
      case BranchNodeKind.Group:
        return {
          id: node.id,
          label: node.label,
          icon: codicon(node.id === LOCAL_ID ? "device-desktop" : "cloud"),
          children: toTreeNodes(node.children, repo),
        };
      case BranchNodeKind.Folder:
        return {
          id: node.id,
          label: node.label,
          icon: codicon("folder"),
          openedIcon: codicon("folder-opened"),
          children: toTreeNodes(node.children, repo),
        };
      case BranchNodeKind.Branch: {
        const menu = { menu: menuOf(node, repo) };
        return node.current
          ? {
              id: node.id,
              label: node.label,
              bold: true,
              icon: codicon("tag"),
              iconColor: "var(--vscode-charts-yellow)",
              ...menu,
            }
          : { id: node.id, label: node.label, icon: codicon("git-branch"), ...menu };
      }
      default:
        return assertNever(node, "toTreeNodes");
    }
  });
}

/**
 * 选中的节点是不是一个本地分支，是就给出它的全名（更新、推送的对象）。
 * 顶上那行 HEAD 代表当前分支（detached 时不是）；远程分支、目录、分组都不是。
 * 是不是当前分支、上游是什么，由扩展执行时自己问 git，不用这里可能过时的状态。
 */
export function localBranchOf(node: BranchNode): string | undefined {
  switch (node.kind) {
    case BranchNodeKind.Head:
      return node.branch;
    case BranchNodeKind.Branch:
      return node.ref.kind === RefKind.LocalBranch ? node.ref.name : undefined;
    case BranchNodeKind.Group:
    case BranchNodeKind.Folder:
      return undefined;
    default:
      return assertNever(node, "localBranchOf");
  }
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
    if (node.kind === BranchNodeKind.Group || node.kind === BranchNodeKind.Folder) {
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
 * 本地分支相对上游的同步状态（`.notes/design/phase-3.md` 第一节第 5 条）。
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

/**
 * 右键菜单上下文：和 `package.json` 菜单项的 `when` 条件对应。
 * 都带起点（New Branch from Here…）；本地分支（含 HEAD 行代表的当前分支）与远程分支再各带自己的。
 */
function menuOf(node: PointNode, repo: string): Readonly<Record<string, string | boolean>> {
  const { start, name } = pointOf(node);
  const common = {
    [MenuContextKey.Repo]: repo,
    [MenuContextKey.Start]: start,
    [MenuContextKey.StartName]: name,
  };
  if (node.kind === BranchNodeKind.Head) {
    return node.branch === undefined ? common : localBranchMenu(common, node.branch, true);
  }
  const ref = node.ref;
  switch (ref.kind) {
    case RefKind.LocalBranch:
      return localBranchMenu(common, ref.name, node.current);
    case RefKind.RemoteBranch:
      return {
        ...common,
        [MenuContextKey.Node]: MenuNodeValue.RemoteBranch,
        [MenuContextKey.Remote]: ref.remote,
        [MenuContextKey.Branch]: ref.name,
      };
    default:
      return assertNever(ref, "menuOf");
  }
}

function localBranchMenu(
  common: Readonly<Record<string, string>>,
  branch: string,
  current: boolean,
): Readonly<Record<string, string | boolean>> {
  return {
    ...common,
    [MenuContextKey.Node]: MenuNodeValue.LocalBranch,
    [MenuContextKey.Branch]: branch,
    [MenuContextKey.Current]: current,
  };
}
