/**
 * 试 Reset 的四种做法：main 上四条提交（`a.txt` 在后三条里各改一次），跟踪 `origin/main` 停在第二条；
 * 本地改动 `b.txt` 已暂存、`c.txt` 未暂存（都不被那几条提交碰，Keep 能保住）。
 * 想看 Keep 被拒：先在工作区改 `a.txt` 再 Reset → Keep 到第一条。
 */
export function build(g) {
  g.write("a.txt", "1\n");
  g.write("b.txt", "b\n");
  g.write("c.txt", "c\n");
  g.git("add", "-A");
  g.git("commit", "-qm", "one");
  for (const n of ["2", "3", "4"]) {
    g.write("a.txt", `${n}\n`);
    g.git("commit", "-qam", `change a to ${n}`);
  }
  // 只要远程分支记录与跟踪配置，不连真的远程：看 reset 后 ahead / behind 怎么变。
  g.git("config", "remote.origin.url", "../nowhere.git");
  g.git("config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*");
  g.git("update-ref", "refs/remotes/origin/main", "HEAD~2");
  g.git("branch", "-q", "--set-upstream-to=origin/main");
  g.write("b.txt", "b local\n");
  g.git("add", "b.txt");
  g.write("c.txt", "c local\n");
}
