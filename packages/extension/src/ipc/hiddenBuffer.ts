import type { GitDomain } from "@dummy-git/shared";

/**
 * 视图隐藏期间，「哪些域过期了」的广播先攒着，重新可见时一次发出。
 *
 * 视图开了 `retainContextWhenHidden`：收起时页面还在，但 VS Code 不把消息送给隐藏的页面，悄悄丢掉
 * （GitLens 的 `eventVisibilityBuffer.ts` 为同一件事做了缓冲）。不攒的话，收起期间在终端里提交、切分支，
 * 再展开看到的还是旧的。只攒域（去重），不攒消息：页面按域决定重拉什么，攒多少次都只拉一回。
 */
export class HiddenBuffer {
  private readonly pending = new Set<GitDomain>();

  constructor(private visible: boolean) {}

  /** 有域过期了：可见时原样交回、马上发；隐藏时攒下，交回空的。 */
  changed(domains: Iterable<GitDomain>): readonly GitDomain[] {
    if (this.visible) return [...domains];
    for (const domain of domains) this.pending.add(domain);
    return [];
  }

  /** 可见性变了：变成可见时交回攒下的（没有就是空的）并清空；变成隐藏时交回空的。 */
  setVisible(visible: boolean): readonly GitDomain[] {
    this.visible = visible;
    if (!visible) return [];
    const flushed = [...this.pending];
    this.pending.clear();
    return flushed;
  }
}
