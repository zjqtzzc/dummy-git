/**
 * 看提交图用：分叉、合并、多父合并、没合回的分支、跨很多行的长线。
 * 提交都是空提交，时间一个比一个晚一分钟，`--date-order` 的顺序就是下面写的顺序倒过来。
 *
 * 从下往上（列表从上往下倒过来）：
 * - main 起头三个提交，打 tag v1.0；
 * - old 从第一个提交分出，一个提交，最后才合回 main——中间隔着 35 个提交，是一条长线；
 * - feature/a 从 main 分出两个提交，--no-ff 合回；
 * - x、y、z 各一个提交，一次三方合并合回 main；
 * - feature/b 从 main 分出两个提交，没合回；
 * - origin/main 停在 main 的前一个提交，HEAD 在 main；
 * - feature/b 跟踪 origin/feature/b（同一提交），a: second 上另有一个超长名字的分支。
 */
export function build(g) {
  // git 子进程继承 process.env：提交前把两个时间设成「一分钟一个」，最后一个停在现在。
  let minute = 100;
  const tick = () => {
    minute -= 1;
    const at = new Date(Date.now() - minute * 60_000).toISOString();
    process.env.GIT_AUTHOR_DATE = at;
    process.env.GIT_COMMITTER_DATE = at;
  };
  const commit = (message) => {
    tick();
    g.git("commit", "-q", "--allow-empty", "-m", message);
  };
  const merge = (message, ...branches) => {
    tick();
    g.git("merge", "-q", "--no-ff", "-m", message, ...branches);
  };

  commit("init");
  g.git("branch", "old");
  commit("main 1");
  commit("main 2");
  g.git("tag", "v1.0");

  g.git("switch", "-q", "old");
  commit("old: forgotten work");
  g.git("switch", "-q", "main");

  g.git("switch", "-q", "-c", "feature/a");
  commit("a: first");
  commit("a: second");
  g.git("switch", "-q", "main");
  commit("main 3");
  merge("Merge feature/a", "feature/a");

  for (const name of ["x", "y", "z"]) {
    g.git("switch", "-q", "-c", name, "main");
    commit(`${name}: work`);
  }
  g.git("switch", "-q", "main");
  merge("Octopus merge x y z", "x", "y", "z");

  for (let i = 1; i <= 35; i++) commit(`main filler ${i}`);
  merge("Merge old", "old");

  g.git("switch", "-q", "-c", "feature/b");
  commit("b: first");
  commit("b: second");
  g.git("switch", "-q", "main");
  commit("main 4");
  g.git("update-ref", "refs/remotes/origin/main", "main");
  commit("main 5");

  // 标签：feature/b 跟踪指向同一提交的 origin/feature/b（合成一个标签）；
  // 一个超长的分支名停在 a: second（截掉开头）。
  // origin 只是个名字，地址不会被访问。
  g.git("remote", "add", "origin", "https://example.invalid/graph.git");
  g.git("update-ref", "refs/remotes/origin/feature/b", "feature/b");
  g.git("branch", "-q", "--set-upstream-to=origin/feature/b", "feature/b");
  g.git("branch", "feature/a-very-long-branch-name-for-labels", "feature/a");
  delete process.env.GIT_AUTHOR_DATE;
  delete process.env.GIT_COMMITTER_DATE;
}
