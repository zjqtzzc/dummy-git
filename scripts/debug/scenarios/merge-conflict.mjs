/**
 * 停在 merge 冲突：main 合并 feature，`f.txt` 两边都改。另有一个未跟踪的 `note.txt`。
 * 用来看冲突组标题的继续 / 放弃，以及提交按钮被锁住。
 */
export function build(g) {
  g.write("f.txt", "base\n");
  g.git("add", "-A");
  g.git("commit", "-qm", "base");
  g.git("switch", "-c", "feature");
  g.write("f.txt", "feature\n");
  g.git("commit", "-qam", "feature");
  g.git("switch", "main");
  g.write("f.txt", "main\n");
  g.git("commit", "-qam", "main");
  g.gitMayFail("merge", "feature");
  g.write("note.txt", "side\n");
}
