/**
 * 一万条以上的提交，看截断处与测图的耗时。
 *
 * 用 fast-import 一次造 10,500 个空提交（逐个 commit 要几分钟）。时间每个晚一分钟，最后一个停在现在。
 * 主线上不断分出分支：每个分支走若干提交后合回 main，同时最多开着 6 个；固定种子，每次建出来一样。
 * 骨架只取最新的一万条，最老的 500 条不在列表里：第一万条附近的提交，父提交缺失，线画到行底渐隐。
 * 结束时还开着的分支留下 ref，其余合并过的分支删掉。
 */
const TOTAL = 10_500;
const MAX_BRANCHES = 6;

export function build(g) {
  let seed = 42;
  const random = () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
    return seed / 2 ** 31;
  };
  const start = Math.floor(Date.now() / 1000) - TOTAL * 60;
  const lines = [];
  let mark = 0;
  const commit = (ref, message, from, merge) => {
    mark += 1;
    const at = start + mark * 60;
    lines.push(
      `commit refs/heads/${ref}`,
      `mark :${mark}`,
      `committer Dummy <dummy@example.com> ${at} +0000`,
      `data ${Buffer.byteLength(message)}`,
      message,
    );
    if (from !== undefined) lines.push(`from :${from}`);
    if (merge !== undefined) lines.push(`merge :${merge}`);
    lines.push("");
    return mark;
  };

  let main = commit("main", "init");
  /** 开着的分支：名字 → 最新提交。 */
  const branches = new Map();
  let next = 1;
  while (mark < TOTAL) {
    const roll = random();
    if (roll < 0.06 && branches.size < MAX_BRANCHES) {
      const name = `feature/${next++}`;
      branches.set(name, commit(name, `${name}: start`, main));
    } else if (roll < 0.12 && branches.size > 0) {
      const names = [...branches.keys()];
      const name = names[Math.floor(random() * names.length)];
      main = commit("main", `Merge ${name}`, main, branches.get(name));
      branches.delete(name);
    } else {
      const names = ["main", ...branches.keys()];
      const name = names[Math.floor(random() * names.length)];
      if (name === "main") main = commit("main", `main ${mark + 1}`, main);
      else branches.set(name, commit(name, `${name}: work`, branches.get(name)));
    }
  }

  g.gitInput(`${lines.join("\n")}\n`, "fast-import", "--quiet");
  const merged = [];
  for (let i = 1; i < next; i++) {
    if (!branches.has(`feature/${i}`)) merged.push(`delete refs/heads/feature/${i}`);
  }
  g.gitInput(`${merged.join("\n")}\n`, "update-ref", "--stdin");
  g.git("reset", "-q", "--hard", "main");
}
