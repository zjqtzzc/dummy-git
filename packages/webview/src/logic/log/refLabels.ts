import { assertNever, type Ref, RefKind } from "@dummy-git/shared";
import { isRemoteHead } from "./branchTree.js";

/** 提交行上的一个 ref 标签。 */
export interface RefLabel {
  /** 决定图标。本地分支与它跟踪的远程分支合成的标签算本地分支。 */
  readonly kind: RefKind;
  /** 显示的名字，太长时截掉开头。合成的标签写成「远程 & 本地分支」。 */
  readonly name: string;
  /** 悬停提示：完整名字；合成的标签带上远程分支。 */
  readonly title: string;
  /** 当前分支。 */
  readonly current: boolean;
}

/** 超过这个长度的名字，第一个 `/` 之前换成 `..`。 */
const MAX_NAME = 22;

/**
 * 每个提交上的标签，按顺序：detached HEAD → 当前分支 → 其它本地分支 → 远程分支 → tag，同类按名字。
 * 本地分支与它跟踪的、指向同一个提交的远程分支合成一个标签。指着当前分支的 HEAD 不单独出标签。
 */
export function refLabels(refs: readonly Ref[]): Map<string, RefLabel[]> {
  const current = refs.find((ref) => ref.kind === RefKind.Head)?.branch;
  const remoteKey = (remote: string, name: string) => `${remote}/${name}`;
  const remotes = new Map<string, string>();
  for (const ref of refs) {
    if (ref.kind === RefKind.RemoteBranch) remotes.set(remoteKey(ref.remote, ref.name), ref.target);
  }
  /** 被本地分支合并掉的远程分支。 */
  const merged = new Set<string>();
  const upstreamOf = new Map<string, { readonly remote: string; readonly key: string }>();
  for (const ref of refs) {
    if (ref.kind !== RefKind.LocalBranch || ref.upstream === undefined) continue;
    const key = remoteKey(ref.upstream.remote, ref.upstream.name);
    if (remotes.get(key) !== ref.target) continue;
    merged.add(key);
    upstreamOf.set(ref.name, { remote: ref.upstream.remote, key });
  }

  const ranked: { readonly target: string; readonly rank: number; readonly label: RefLabel }[] = [];
  const add = (ref: Ref, kind: RefKind, full: string, title: string, rank: number) =>
    ranked.push({
      target: ref.target,
      rank,
      label: { kind, name: shorten(full), title, current: rank === 1 },
    });
  for (const ref of refs) {
    switch (ref.kind) {
      case RefKind.Head:
        if (ref.branch === undefined) add(ref, ref.kind, "HEAD", "HEAD", 0);
        break;
      case RefKind.LocalBranch: {
        const upstream = upstreamOf.get(ref.name);
        const rank = ref.name === current ? 1 : 2;
        if (upstream === undefined) add(ref, ref.kind, ref.name, ref.name, rank);
        else
          add(
            ref,
            ref.kind,
            `${upstream.remote} & ${ref.name}`,
            `${ref.name} ↔ ${upstream.key}`,
            rank,
          );
        break;
      }
      case RefKind.RemoteBranch: {
        if (isRemoteHead(ref)) break;
        const full = remoteKey(ref.remote, ref.name);
        if (merged.has(full)) break;
        add(ref, ref.kind, full, full, 3);
        break;
      }
      case RefKind.Tag:
        add(ref, ref.kind, ref.name, ref.name, 4);
        break;
      default:
        assertNever(ref, "refLabels");
    }
  }

  ranked.sort((a, b) => a.rank - b.rank || a.label.title.localeCompare(b.label.title));
  const byCommit = new Map<string, RefLabel[]>();
  for (const { target, label } of ranked) {
    const labels = byCommit.get(target);
    if (labels === undefined) byCommit.set(target, [label]);
    else labels.push(label);
  }
  return byCommit;
}

/** 太长的名字把第一个 `/` 之前换成 `..`；还放不下的由界面的省略号处理。 */
function shorten(name: string): string {
  const slash = name.indexOf("/");
  return name.length <= MAX_NAME || slash === -1 ? name : `..${name.slice(slash)}`;
}
