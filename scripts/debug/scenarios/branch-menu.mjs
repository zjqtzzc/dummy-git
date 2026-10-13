/**
 * 当前在 main。
 * feature 与 main 都改了 f.txt，合并会冲突。
 * topic 只比 main 多一个文件，合并会快进。
 * origin/feature 是一条远程分支记录。
 * note.txt 有未提交的修改，变基时会先收起再取回。
 */
export function build(g) {
  g.write("f.txt", "base\n");
  g.write("note.txt", "base\n");
  g.git("add", "-A");
  g.git("commit", "-qm", "base");
  g.git("switch", "-c", "feature");
  g.write("f.txt", "feature\n");
  g.git("commit", "-qam", "feature");
  g.git("switch", "main");
  g.write("f.txt", "main\n");
  g.git("commit", "-qam", "main");
  g.git("switch", "-c", "topic");
  g.write("extra.txt", "extra\n");
  g.git("add", "extra.txt");
  g.git("commit", "-qm", "topic");
  g.git("switch", "main");
  g.git("update-ref", "refs/remotes/origin/feature", "feature");
  g.write("note.txt", "dirty\n");
}
