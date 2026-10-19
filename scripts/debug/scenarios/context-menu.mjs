/**
 * 右键菜单：每块面板上各种节点都有一个，来回交替右键看菜单跟不跟着变。
 *
 * 提交列表：base → side（--no-ff 合进 main）→ one、two、three。合并之后的三条能改说明，合并提交和之前的不能。
 * 分支树：当前分支 main；本地 topic、feat/login/a、feat/login/b（目录）；远程 origin/main、origin/feat/x（目录）。
 * Stash：一条，pop 时在 f.txt 上冲突，所以还留在列表里。
 * Commit 面板：Conflicts 里 f.txt（两边都改）；Changes 里 a.txt；Unversioned Files 里 new.txt 和目录 docs/new/ 下的一个文件。
 * Log 右栏：选中 side、one 这些有文件的提交，文件树里有文件可以右键。
 */
export function build(g) {
  g.write("f.txt", "base\n");
  g.write("a.txt", "base\n");
  g.git("add", "-A");
  g.git("commit", "-qm", "base");
  g.git("branch", "topic");
  g.git("branch", "feat/login/a");
  g.git("branch", "feat/login/b");
  g.git("update-ref", "refs/remotes/origin/feat/x", "HEAD");

  g.git("switch", "-q", "-c", "side");
  g.write("side.txt", "side\n");
  g.git("add", "side.txt");
  g.git("commit", "-qm", "side");
  g.git("switch", "-q", "main");
  g.git("merge", "-q", "--no-ff", "-m", "Merge branch 'side'", "side");
  g.git("branch", "-q", "-D", "side");

  g.write("one.txt", "one\n");
  g.git("add", "one.txt");
  g.git("commit", "-qm", "one");
  g.write("two.txt", "two\n");
  g.git("add", "two.txt");
  g.git("commit", "-qm", "two");
  g.git("update-ref", "refs/remotes/origin/main", "HEAD");

  // stash 先记下 f.txt 的一种改法，main 再提交另一种，pop 时就冲突。
  g.write("f.txt", "stashed\n");
  g.git("stash", "-q");
  g.write("f.txt", "committed\n");
  g.git("commit", "-qam", "three");
  g.gitMayFail("stash", "pop");

  g.write("a.txt", "changed\n");
  g.write("new.txt", "untracked\n");
  g.write("docs/new/notes.txt", "untracked\n");
}
