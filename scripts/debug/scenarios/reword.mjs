/**
 * 改提交说明：main 上先有一次 --no-ff 合并（feature），合并之后三条提交 one（多行说明）、two、three。
 * 能改的只有合并之后的三条；合并提交、它之前的、feature 上的都不能改。
 * `a.txt` 已暂存、`b.txt` 未暂存、`c.txt` 未跟踪：改完说明后它们应原样留着。
 */
export function build(g) {
  g.write("a.txt", "base\n");
  g.write("b.txt", "base\n");
  g.git("add", "-A");
  g.git("commit", "-qm", "base");
  g.git("switch", "-q", "-c", "feature");
  g.write("feature.txt", "feature\n");
  g.git("add", "feature.txt");
  g.git("commit", "-qm", "feature");
  g.git("switch", "-q", "main");
  g.git("merge", "-q", "--no-ff", "-m", "Merge branch 'feature'", "feature");

  g.write("one.txt", "one\n");
  g.git("add", "one.txt");
  g.git(
    "commit",
    "-qm",
    "one: subject line",
    "-m",
    "Body paragraph one.\nSecond line of the body.",
  );
  g.write("two.txt", "two\n");
  g.git("add", "two.txt");
  g.git("commit", "-qm", "two");
  g.write("three.txt", "three\n");
  g.git("add", "three.txt");
  g.git("commit", "-qm", "three");

  g.write("a.txt", "staged\n");
  g.git("add", "a.txt");
  g.write("b.txt", "unstaged\n");
  g.write("c.txt", "untracked\n");
}
