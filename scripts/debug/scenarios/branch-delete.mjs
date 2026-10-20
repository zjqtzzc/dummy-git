/**
 * 批量删分支：在 main（当前分支）。远程 origin 是本地的裸仓库，能真删。
 *
 *   Local:   main（当前）、topic（已合并）
 *            feat/login/a、feat/login/b（已合并）
 *            wip/x、wip/y（各有一条只在自己上面的提交，没合并）
 *   Remote:  origin/main、origin/old/a、origin/old/b（远程上真有）
 */
export function build(g) {
  g.write("f.txt", "base\n");
  g.git("add", "-A");
  g.git("commit", "-qm", "base");
  g.write(".git/info/exclude", "origin.git/\n");
  g.git("init", "--bare", "-q", "origin.git");
  g.git("remote", "add", "origin", "origin.git");
  for (const name of ["topic", "feat/login/a", "feat/login/b", "old/a", "old/b"]) {
    g.git("branch", "-q", name);
  }
  g.git("push", "-q", "origin", "main", "old/a", "old/b");
  g.git("branch", "-q", "-D", "old/a", "old/b");
  g.git("branch", "-q", "-u", "origin/main");
  for (const name of ["wip/x", "wip/y"]) {
    g.git("switch", "-q", "-c", name);
    g.git("commit", "-q", "--allow-empty", "-m", `only ${name}`);
    g.git("switch", "-q", "main");
  }
}
