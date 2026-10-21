/**
 * 提交列表的高亮：当前分支 main 上的带浅色背景，合并提交文字变灰。
 *
 *   main     base → side（--no-ff 合进来）→ one、two。合并提交变灰；side 那一支也在 main 上，带浅色。
 *   feature  从 base 分出，两条只在它上面的提交：不带浅色。按 feature 过滤时，只有 base 带浅色。
 *   pages    孤儿分支，和 main 没有共同祖先：按它过滤时一条都不带浅色。
 *   tag old  指着 one：`git switch --detach old` 之后，浅色只到 one 为止（HEAD 游离也照样涂）。
 */
export function build(g) {
  g.write("f.txt", "base\n");
  g.git("add", "-A");
  g.git("commit", "-qm", "base");

  g.git("switch", "-q", "-c", "feature");
  g.git("commit", "-q", "--allow-empty", "-m", "feature one");
  g.git("commit", "-q", "--allow-empty", "-m", "feature two");

  g.git("switch", "-q", "-c", "side", "main");
  g.git("commit", "-q", "--allow-empty", "-m", "side");
  g.git("switch", "-q", "main");
  g.git("merge", "-q", "--no-ff", "-m", "Merge branch 'side'", "side");
  g.git("branch", "-q", "-D", "side");

  g.git("commit", "-q", "--allow-empty", "-m", "one");
  g.git("tag", "old");
  g.git("commit", "-q", "--allow-empty", "-m", "two");

  g.git("switch", "-q", "--orphan", "pages");
  g.git("commit", "-q", "--allow-empty", "-m", "pages");
  g.git("switch", "-q", "main");
}
