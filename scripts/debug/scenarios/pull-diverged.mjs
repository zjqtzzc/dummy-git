/**
 * 当前在 main，跟踪 origin/main，两边各有新提交。
 * note.txt 有未提交修改。
 * other 也跟踪 origin/main，比分叉点多一个文件，不是当前分支。
 */
export function build(g) {
  g.write("f.txt", "base\n");
  g.write("note.txt", "base\n");
  g.git("add", "-A");
  g.git("commit", "-qm", "base");
  g.git("init", "--bare", "-q", "origin.git");
  g.write(".git/info/exclude", "origin.git/\n");
  g.git("remote", "add", "origin", "origin.git");
  g.git("push", "-q", "-u", "origin", "main");

  g.git("switch", "-q", "-c", "other");
  g.write("other.txt", "other\n");
  g.git("add", "other.txt");
  g.git("commit", "-qm", "other");
  g.git("branch", "-q", "-u", "origin/main");
  g.git("switch", "-q", "main");

  g.git("switch", "-q", "-c", "remote-side");
  g.write("remote.txt", "remote\n");
  g.git("add", "remote.txt");
  g.git("commit", "-qm", "remote");
  g.git("push", "-q", "origin", "remote-side:main");
  g.git("switch", "-q", "main");
  g.git("branch", "-q", "-D", "remote-side");

  g.write("local.txt", "local\n");
  g.git("add", "local.txt");
  g.git("commit", "-qm", "local");
  g.write("note.txt", "dirty\n");
}
