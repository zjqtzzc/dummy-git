/**
 * Commit 面板、Stash 的 View Options（按目录分组 ↔ 平铺）：停在 merge 冲突里，三组都有目录。
 *
 *   Conflicts:          src/core/m.txt（两边都改，灰字是冲突类型）
 *   Changes:            src/core/a.txt、src/ui/b.txt、top.txt（修改）；docs/new-name.md（从 docs/old-name.md 改名）
 *   Unversioned Files:  notes/todo.txt、z.txt
 *   Stash:              一条，改了 lib/x/one.txt、lib/y/two.txt、root.txt
 */
export function build(g) {
  for (const file of [
    "src/core/m.txt",
    "src/core/a.txt",
    "src/ui/b.txt",
    "top.txt",
    "docs/old-name.md",
    "lib/x/one.txt",
    "lib/y/two.txt",
    "root.txt",
  ]) {
    g.write(file, "base\n");
  }
  g.git("add", "-A");
  g.git("commit", "-qm", "base");

  // stash：先存一条带目录的。
  for (const file of ["lib/x/one.txt", "lib/y/two.txt", "root.txt"]) g.write(file, "stashed\n");
  g.git("stash", "-q");

  g.git("switch", "-q", "-c", "feature");
  g.write("src/core/m.txt", "feature\n");
  g.git("commit", "-qam", "feature");
  g.git("switch", "-q", "main");
  g.write("src/core/m.txt", "main\n");
  g.git("commit", "-qam", "main");
  g.gitMayFail("merge", "feature");

  for (const file of ["src/core/a.txt", "src/ui/b.txt", "top.txt"]) g.write(file, "changed\n");
  g.git("mv", "docs/old-name.md", "docs/new-name.md");
  g.write("notes/todo.txt", "untracked\n");
  g.write("z.txt", "untracked\n");
}
