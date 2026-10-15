/**
 * 推送对话框：两个远程 origin、fork（都是本地的裸仓库，能真推）。
 * main 跟踪 origin/main，本地多两条提交；fork 上也有 main（停在 base）。
 * feat 从 main 分出、多一条提交，没有上游，两个远程上都没有它。
 */
export function build(g) {
  g.write("f.txt", "base\n");
  g.git("add", "-A");
  g.git("commit", "-qm", "base");
  g.write(".git/info/exclude", "origin.git/\nfork.git/\n");
  for (const remote of ["origin", "fork"]) {
    g.git("init", "--bare", "-q", `${remote}.git`);
    g.git("remote", "add", remote, `${remote}.git`);
    g.git("push", "-q", remote, "main");
  }
  g.git("branch", "-q", "-u", "origin/main");

  g.write("f.txt", "one\n");
  g.git("commit", "-qam", "one");
  g.write("f.txt", "two\n");
  g.git("commit", "-qam", "two");

  g.git("switch", "-q", "-c", "feat");
  g.write("feat.txt", "feat\n");
  g.git("add", "feat.txt");
  g.git("commit", "-qm", "feat");
  g.git("switch", "-q", "main");
}
