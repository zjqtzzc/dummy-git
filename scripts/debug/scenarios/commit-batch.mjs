/**
 * Commit 面板的批量操作：停在 merge 冲突里（main 合并 feature），文件三类各好几个。
 *
 *   Conflicts:          m1.txt、m2.txt（两边都改，合并编辑器解决）
 *                       gone1.txt、gone2.txt（feature 删了、main 改了，保留或删除）
 *   Changes:            src/a.txt、src/b.txt、top.txt（已跟踪的修改）
 *   Unversioned Files:  new/x.txt、new/y.txt、z.txt（未跟踪）
 */
export function build(g) {
  for (const file of [
    "m1.txt",
    "m2.txt",
    "gone1.txt",
    "gone2.txt",
    "src/a.txt",
    "src/b.txt",
    "top.txt",
  ]) {
    g.write(file, "base\n");
  }
  g.git("add", "-A");
  g.git("commit", "-qm", "base");
  g.git("switch", "-q", "-c", "feature");
  g.write("m1.txt", "feature\n");
  g.write("m2.txt", "feature\n");
  g.git("rm", "-q", "gone1.txt", "gone2.txt");
  g.git("commit", "-qam", "feature");
  g.git("switch", "-q", "main");
  g.write("m1.txt", "main\n");
  g.write("m2.txt", "main\n");
  g.write("gone1.txt", "main\n");
  g.write("gone2.txt", "main\n");
  g.git("commit", "-qam", "main");
  g.gitMayFail("merge", "--no-edit", "feature");

  g.write("src/a.txt", "changed\n");
  g.write("src/b.txt", "changed\n");
  g.write("top.txt", "changed\n");
  g.write("new/x.txt", "untracked\n");
  g.write("new/y.txt", "untracked\n");
  g.write("z.txt", "untracked\n");
}
