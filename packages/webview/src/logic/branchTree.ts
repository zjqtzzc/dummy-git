import { assertNever, type Ref, RefKind } from "@dummy-git/shared";

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

export type BranchNode =
  | { readonly kind: BranchNodeKind.Head; readonly id: string; readonly label: string }
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
    };

const HEAD_ID = "head";
const LOCAL_ID = "local";
const REMOTE_ID = "remote";

export function buildBranchTree(refs: readonly Ref[]): readonly BranchNode[] {
  let head: Extract<Ref, { kind: RefKind.Head }> | undefined;
  const local: string[] = [];
  const remotes = new Map<string, string[]>();

  for (const ref of refs) {
    switch (ref.kind) {
      case RefKind.Head:
        head = ref;
        break;
      case RefKind.LocalBranch:
        local.push(ref.name);
        break;
      case RefKind.RemoteBranch:
        // `origin/HEAD` 只是指向远程默认分支的指针，不是一个分支。
        if (ref.name !== "HEAD")
          remotes.set(ref.remote, [...(remotes.get(ref.remote) ?? []), ref.name]);
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
    nodes.push({
      kind: BranchNodeKind.Head,
      id: HEAD_ID,
      label:
        head.branch === undefined
          ? `HEAD (detached at ${head.target.slice(0, 7)})`
          : `HEAD → ${head.branch}`,
    });
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

/** 一组分支名按 `/` 折叠成目录。`current` 是要标出的当前分支全名（只在 Local 里有）。 */
function folderize(
  parentId: string,
  names: readonly string[],
  current: string | undefined,
  prefix = "",
): readonly BranchNode[] {
  const folders = new Map<string, string[]>();
  const leaves: string[] = [];
  for (const name of names) {
    const slash = name.indexOf("/");
    if (slash === -1) {
      leaves.push(name);
    } else {
      const folder = name.slice(0, slash);
      folders.set(folder, [...(folders.get(folder) ?? []), name.slice(slash + 1)]);
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
    ...leaves.sort(byName).map(
      (leaf): BranchNode => ({
        kind: BranchNodeKind.Branch,
        id: `${parentId}/${leaf}`,
        label: leaf,
        current: `${prefix}${leaf}` === current,
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
