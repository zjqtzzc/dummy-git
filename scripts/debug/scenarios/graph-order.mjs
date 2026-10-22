/**
 * Log 的 Graph Options（排序）：两条分支交替提交、再合并，按提交时间和拓扑排出来不一样。
 *
 *   main：base → a1 → a2 → a3 → merge（合进 feature）
 *   feature：从 base 分出，b1、b2、b3，和 a1～a3 一条一条交替提交（时间交错）
 *
 * By Commit Date：merge、b3、a3、b2、a2、b1、a1、base，两支穿插。
 * Topologically：merge 下面先是 feature 那一支（b3、b2、b1）连在一起，再是 a3、a2、a1。
 */
export function build(g) {
  let tick = 0;
  /** 提交时间一条比一条晚一分钟，交替的顺序才稳定。 */
  const commit = (message) => {
    tick += 1;
    process.env.GIT_COMMITTER_DATE = `${1_700_000_000 + tick * 60} +0000`;
    process.env.GIT_AUTHOR_DATE = process.env.GIT_COMMITTER_DATE;
    g.git("commit", "-q", "--allow-empty", "-m", message);
  };

  g.write("f.txt", "base\n");
  g.git("add", "-A");
  commit("base");
  g.git("branch", "feature");
  for (const n of [1, 2, 3]) {
    g.git("switch", "-q", "main");
    commit(`a${n}`);
    g.git("switch", "-q", "feature");
    commit(`b${n}`);
  }
  g.git("switch", "-q", "main");
  tick += 1;
  process.env.GIT_COMMITTER_DATE = `${1_700_000_000 + tick * 60} +0000`;
  process.env.GIT_AUTHOR_DATE = process.env.GIT_COMMITTER_DATE;
  g.git("merge", "-q", "--no-ff", "-m", "merge feature", "feature");
  delete process.env.GIT_COMMITTER_DATE;
  delete process.env.GIT_AUTHOR_DATE;
}
