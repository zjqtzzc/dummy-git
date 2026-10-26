/**
 * 停在半路的 merge（main 合并 other）：冲突组标题行的继续 / 放弃，Commit 与 Amend 锁住，Reword 被拒，
 * 合并编辑器、Mark as Resolved、Keep、Delete File 与它们的批量，右键 Open File。
 *
 * Conflicts：
 *   m1.txt、m2.txt  两边都改（UU）           added.txt  两边都新增（AA）
 *   x1.txt、x2.txt  对方删了、我们改了（UD）  u.txt      我们删了、对方改了（DU）
 *   y.txt 两边改成不同名字：y.txt 两边都删了（DD），w.txt 只有我们加了（AU），z.txt 只有对方加了（UA）
 * Changes：clean.txt 只有对方改，合并时干净合入（对照）；renamed.txt 改名自 old.txt；gone.txt 删了；
 *   from.txt 改名成 to.txt 后又删掉 to.txt，画成 from.txt 的删除。
 * Unversioned Files：new.txt。
 */
export function build(g) {
  // 内容各不相同：一样的话 git 认改名时会把不相干的两个文件配成一对。
  for (const name of ["m1", "m2", "x1", "x2", "u", "y", "clean", "old", "gone", "from"]) {
    g.write(`${name}.txt`, `${name} base\n`);
  }
  g.git("add", "-A");
  g.git("commit", "-qm", "base");

  g.git("switch", "-q", "-c", "other");
  g.write("m1.txt", "m1 theirs\n");
  g.write("m2.txt", "m2 theirs\n");
  g.write("u.txt", "u theirs\n");
  g.write("clean.txt", "clean theirs\n");
  g.write("added.txt", "added by them\n");
  g.git("rm", "-q", "x1.txt", "x2.txt");
  g.git("mv", "y.txt", "z.txt");
  g.git("add", "-A");
  g.git("commit", "-qm", "other");

  g.git("switch", "-q", "main");
  g.write("m1.txt", "m1 ours\n");
  g.write("m2.txt", "m2 ours\n");
  g.write("x1.txt", "x1 ours\n");
  g.write("x2.txt", "x2 ours\n");
  g.write("added.txt", "added by us\n");
  g.git("rm", "-q", "u.txt");
  g.git("mv", "y.txt", "w.txt");
  g.git("add", "-A");
  g.git("commit", "-qm", "ours");
  g.gitMayFail("merge", "other");

  g.git("mv", "old.txt", "renamed.txt");
  g.remove("gone.txt");
  g.git("mv", "from.txt", "to.txt");
  g.remove("to.txt");
  g.write("new.txt", "untracked\n");
}
