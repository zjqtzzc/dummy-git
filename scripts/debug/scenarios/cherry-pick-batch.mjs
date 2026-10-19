/**
 * 批量 cherry-pick / revert：在 main 上，feature 从 base 分出四条提交，从旧到新是：
 *
 *   a       新文件 a.txt                    能直接摘
 *   applied 新文件 applied.txt              main 上已经摘过一次，再摘就「变空」
 *   clash   改 f.txt                        和 main 上对 f.txt 的修改冲突
 *   b       新文件 b.txt                    能直接摘
 *
 * main 上：base 之后改了 f.txt（main f），再摘过一次 applied。工作区干净。
 * revert 用 main 自己的提交试：main f、applied 都能撤；撤过一次再撤就是「变空」。
 */
export function build(g) {
  g.write("f.txt", "base\n");
  g.git("add", "-A");
  g.git("commit", "-qm", "base");
  g.git("switch", "-q", "-c", "feature");
  for (const [name, file, content] of [
    ["a", "a.txt", "a\n"],
    ["applied", "applied.txt", "applied\n"],
    ["clash", "f.txt", "feature\n"],
    ["b", "b.txt", "b\n"],
  ]) {
    g.write(file, content);
    g.git("add", file);
    g.git("commit", "-qm", name);
  }
  g.git("switch", "-q", "main");
  g.write("f.txt", "main\n");
  g.git("commit", "-qam", "main f");
  g.git("cherry-pick", "feature~2");
}
