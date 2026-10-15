/**
 * 推送对话框定义远程：仓库一个远程都没有，main 上两条提交。
 * 旁边有一个空的裸仓库 target.git，定义远程时地址填 `target.git` 就能真推。
 */
export function build(g) {
  g.write("f.txt", "one\n");
  g.git("add", "-A");
  g.git("commit", "-qm", "one");
  g.write("f.txt", "two\n");
  g.git("commit", "-qam", "two");
  g.git("init", "--bare", "-q", "target.git");
  g.write(".git/info/exclude", "target.git/\n");
}
