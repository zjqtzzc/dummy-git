/**
 * 远程同步：Fetch、Update（单个、批量）、Push 对话框、Checkout 远程分支、分叉后 Rebase / Merge。
 * 远程 origin、fork 是现场里的本地裸仓库（写进 .git/info/exclude），能真推真取。
 *
 *   main（当前）  落后 1 条；note.txt 有未提交的修改          当前分支 Update（快进）
 *   feat/a、feat/b 各落后 1 条                                批量 Update，目录
 *   fix           分叉，两边都改了 fix.txt                    分叉通知；选 Rebase / Merge 停在冲突
 *   ahead         领先 2 条，上面有附注 tag v2、轻量 tag light2  Push 对话框的提交列表、推 tag
 *   lonely        没有上游                                    Push 标 New、带 -u；没有 Update
 *   gone          上游在远程删了，本地记录也清了              没有 Update；Push 当作没有上游
 *   other         不跟踪 origin/other                         Checkout origin/other 被拒
 *   origin/remote-only  只在远程                              Checkout 远程分支：建本地分支并跟踪
 *   origin/stale  远程已删、本地记录还在                      手动 Fetch（--prune）把它清掉
 *
 * fork 上只有 main，停在 base：Push 对话框里换远程。
 */
export function build(g) {
  g.write("f.txt", "base\n");
  g.write("fix.txt", "base\n");
  g.write("note.txt", "note\n");
  g.git("add", "-A");
  g.git("commit", "-qm", "base");

  g.write(".git/info/exclude", "origin.git/\nfork.git/\nclone/\n");
  g.git("init", "--bare", "-q", "origin.git");
  g.git("init", "--bare", "-q", "fork.git");
  g.git("remote", "add", "origin", "origin.git");
  g.git("remote", "add", "fork", "fork.git");

  const tracked = ["main", "feat/a", "feat/b", "fix", "ahead", "gone"];
  for (const name of tracked.slice(1)) g.git("branch", name);
  g.git("branch", "lonely");
  g.git("branch", "other");
  g.git("push", "-q", "origin", ...tracked, "main:remote-only", "main:other", "main:stale");
  for (const name of tracked) g.git("branch", "-q", "-u", `origin/${name}`, name);
  g.git("push", "-q", "fork", "main");

  // 远程上的新提交：在一个临时克隆里提交再推回去。
  g.git("clone", "-q", "origin.git", "clone");
  for (const name of ["main", "feat/a", "feat/b"]) {
    g.git("-C", "clone", "switch", "-q", name);
    g.git("-C", "clone", "commit", "-q", "--allow-empty", "-m", `remote ${name}`);
  }
  g.git("-C", "clone", "switch", "-q", "fix");
  g.write("clone/fix.txt", "remote\n");
  g.git("-C", "clone", "commit", "-qam", "remote fix");
  g.git("-C", "clone", "push", "-q", "origin", "main", "feat/a", "feat/b", "fix");
  g.git("-C", "clone", "push", "-q", "origin", "--delete", "gone", "stale");
  // 取回远程的新提交，但不 prune：origin/stale 留着，等手动 Fetch 清；origin/gone 单独清掉。
  g.git("fetch", "-q", "origin");
  g.git("branch", "-q", "-dr", "origin/gone");

  g.git("switch", "-q", "fix");
  g.write("fix.txt", "local\n");
  g.git("commit", "-qam", "local fix");
  g.git("switch", "-q", "ahead");
  g.git("commit", "-q", "--allow-empty", "-m", "ahead one");
  g.git("commit", "-q", "--allow-empty", "-m", "ahead two");
  g.git("tag", "-a", "v2", "-m", "v2");
  g.git("tag", "light2");
  g.git("switch", "-q", "main");

  g.write("note.txt", "note changed\n");
}
