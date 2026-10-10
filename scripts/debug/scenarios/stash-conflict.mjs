/**
 * 停在 stash pop 的冲突里，一次覆盖四种冲突，外加两个不冲突的文件：
 *
 *   both-modified.txt    两边都改          both modified
 *   both-added.txt       两边都新增        both added
 *   deleted-by-them.txt  stash 删、HEAD 改  deleted by them
 *   deleted-by-us.txt    HEAD 删、stash 改  deleted by us
 *   clean.txt            只有 stash 改     pop 时干净合入，已暂存的普通修改
 *   untracked.txt        未跟踪
 *
 * stash pop 里「我方」是当前 HEAD，「对方」是 stash。冲突时 stash 不会被删，stash 列表里还在。
 */
export function build(g) {
  for (const file of [
    "both-modified.txt",
    "deleted-by-them.txt",
    "deleted-by-us.txt",
    "clean.txt",
  ]) {
    g.write(file, "base\n");
  }
  g.git("add", "-A");
  g.git("commit", "-q", "-m", "base");

  // stash 一侧
  g.write("both-modified.txt", "stashed\n");
  g.write("deleted-by-us.txt", "stashed\n");
  g.git("rm", "-q", "deleted-by-them.txt");
  g.write("both-added.txt", "stashed\n");
  g.git("add", "both-added.txt"); // 未跟踪的文件默认不进 stash，先暂存
  g.write("clean.txt", "stashed\n");
  g.git("stash", "-q");

  // HEAD 一侧
  g.write("both-modified.txt", "committed\n");
  g.git("rm", "-q", "deleted-by-us.txt");
  g.write("deleted-by-them.txt", "committed\n");
  g.write("both-added.txt", "committed\n");
  g.git("add", "-A");
  g.git("commit", "-q", "-m", "other");

  g.gitMayFail("stash", "pop");
  g.write("untracked.txt", "untracked\n");
}
