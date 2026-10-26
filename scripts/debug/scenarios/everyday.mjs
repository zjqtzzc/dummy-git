/**
 * 日常：没有停在半路的操作。Log、分支树、Stash、Commit 面板的各种改动、Reset、Reword、各处右键菜单。
 *
 * 提交列表：base → feature（--no-ff 合进 main）→ one（多行说明）、two、three。合并之后的三条能改说明，
 *   合并提交和之前的不能。tag：附注的 v1 在 two，轻量的 v1-light 在 one。
 * 分支树：当前分支 main；本地 topic、feat/login/a、feat/login/b（目录）。
 *   topic 上一条提交改了 f.txt，和 main 的 three 冲突：对它 Cherry-Pick、Merge、Rebase 都能当场造出冲突。
 * Stash：较新的一条带目录 notes/，取回干净；较早的一条改 f.txt，之后 three 又改了 f.txt，Pop 就冲突
 *   （没有停下的操作、只有冲突组）。
 * Commit 面板：
 *   Changes：src/a.txt 修改；src/b.txt 部分暂存；added.txt 新增（已暂存）；gone.txt 删了；
 *     renamed.txt 改名自 old.txt；from.txt 改名成 to.txt 后又删掉 to.txt，画成 from.txt 的删除。
 *   Unversioned Files：new.txt、docs/new/notes.txt、src/new.txt（src/ 两组都有：收起、选中只动一组）。
 *   这些文件 one、two、three 都没碰：Reset → Keep 到合并之后的任一条都保得住。
 */
export function build(g) {
  g.write("f.txt", "base\n");
  g.write("src/a.txt", "a\n");
  g.write("src/b.txt", "b\n");
  g.write("gone.txt", "gone\n");
  g.write("old.txt", "old\n");
  g.write("from.txt", "from\n");
  g.git("add", "-A");
  g.git("commit", "-qm", "base");
  for (const name of ["topic", "feat/login/a", "feat/login/b"]) g.git("branch", name);

  g.git("switch", "-q", "-c", "feature");
  g.write("feature.txt", "feature\n");
  g.git("add", "feature.txt");
  g.git("commit", "-qm", "feature");
  g.git("switch", "-q", "main");
  g.git("merge", "-q", "--no-ff", "-m", "Merge branch 'feature'", "feature");
  g.git("branch", "-q", "-D", "feature");

  g.write("one.txt", "one\n");
  g.git("add", "one.txt");
  g.git("commit", "-qm", "one", "-m", "说明的第二段：多行说明在 Reword 对话框里原样带出。");
  g.git("tag", "v1-light");
  g.write("two.txt", "two\n");
  g.git("add", "two.txt");
  g.git("commit", "-qm", "two");
  g.git("tag", "-a", "v1", "-m", "v1");

  g.write("f.txt", "stashed\n");
  g.git("stash", "push", "-q", "-m", "f.txt 的另一种改法");
  g.write("f.txt", "main\n");
  g.git("commit", "-qam", "three");
  g.write("notes/todo.txt", "todo\n");
  g.git("stash", "push", "-q", "-u", "-m", "notes");

  g.git("switch", "-q", "topic");
  g.write("f.txt", "topic\n");
  g.git("commit", "-qam", "topic");
  g.git("switch", "-q", "main");

  g.write("src/a.txt", "a changed\n");
  g.write("src/b.txt", "b staged\n");
  g.git("add", "src/b.txt");
  g.write("src/b.txt", "b staged\nb unstaged\n");
  g.write("added.txt", "added\n");
  g.git("add", "added.txt");
  g.remove("gone.txt");
  g.git("mv", "old.txt", "renamed.txt");
  g.git("mv", "from.txt", "to.txt");
  g.remove("to.txt");
  g.write("new.txt", "untracked\n");
  g.write("docs/new/notes.txt", "untracked\n");
  g.write("src/new.txt", "untracked\n");
}
