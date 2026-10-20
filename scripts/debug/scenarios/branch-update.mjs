/**
 * 批量更新分支：在 main（当前分支）。远程 origin 是本地的裸仓库，比本地多一条提交。
 *
 *   main、feat/a、feat/b  都跟踪 origin 上的同名分支，远程多一条 → 能快进
 *   fix                   跟踪 origin/fix，本地和远程各多一条 → 分叉
 *   lonely                只在本地，没有上游 → 不能 Update
 */
export function build(g) {
  g.write("f.txt", "base\n");
  g.git("add", "-A");
  g.git("commit", "-qm", "base");
  g.write(".git/info/exclude", "origin.git/\nclone/\n");
  g.git("init", "--bare", "-q", "origin.git");
  g.git("remote", "add", "origin", "origin.git");
  for (const name of ["feat/a", "feat/b", "fix", "lonely"]) g.git("branch", "-q", name);
  g.git("push", "-q", "origin", "main", "feat/a", "feat/b", "fix");
  for (const name of ["main", "feat/a", "feat/b", "fix"]) {
    g.git("branch", "-q", "-u", `origin/${name}`, name);
  }
  // 远程上每个分支多一条：在一个临时克隆里提交再推回去。
  g.git("clone", "-q", "origin.git", "clone");
  for (const name of ["main", "feat/a", "feat/b", "fix"]) {
    g.git("-C", "clone", "switch", "-q", name);
    g.git("-C", "clone", "commit", "-q", "--allow-empty", "-m", `remote ${name}`);
  }
  g.git("-C", "clone", "push", "-q", "origin", "main", "feat/a", "feat/b", "fix");
  // fix 本地也多一条：和远程分叉。
  g.git("switch", "-q", "fix");
  g.git("commit", "-q", "--allow-empty", "-m", "local fix");
  g.git("switch", "-q", "main");
}
