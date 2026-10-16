#!/usr/bin/env node
/**
 * 建 parser 的验证仓库。不是测试——无断言、不进 `pnpm check`。
 * 目的是把「手工验证」的成本从十分钟降到一条命令：
 *
 *   node scripts/fixture.mjs [outDir]     默认 .tmp/fixtures/
 *
 * 产出三个仓库，共享同一段历史：
 *
 *   base/      历史形态齐全 + 工作区有未提交改动（给 status 用）
 *   conflict/  停在 merge 冲突中
 *   detached/  HEAD 游离
 *   tracking/  配了上游（含跟踪本地分支、[gone]）
 *   signed/    带真实 ssh 签名的提交（给 log.showSignature 用）
 *
 * 为什么是三个而不是一个：五种验证输入分两类。
 *   - 历史形态（根提交 / merge / 中文文件名 / 多行消息）是提交图里的对象，能共存；
 *   - 仓库状态（冲突中 / detached HEAD）是 HEAD 与 index 的瞬时状态，**互斥**——
 *     一个仓库不可能既停在冲突中又处于 detached。
 * 所以只能一个基础仓库 + 两个状态变体。
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const outDir = resolve(process.argv[2] ?? ".tmp/fixtures");

/**
 * 固定身份与时间 —— 这是整个脚本最重要的一个决定。
 *
 * commit hash 由「树内容 + 父提交 + author/committer 的名字、邮箱、时间」算出。
 * 任何一项浮动，每次跑出来的 hash 就都不一样，上次的输出和这次的没法对比，
 * 手工验证退化成每次重新肉眼读一遍。
 *
 * 全部固定后，同样的内容永远产出同样的 hash，验证变成 `diff` 一下的事。
 */
const IDENTITY = {
  GIT_AUTHOR_NAME: "Fixture Author",
  GIT_AUTHOR_EMAIL: "author@example.com",
  GIT_COMMITTER_NAME: "Fixture Committer",
  GIT_COMMITTER_EMAIL: "committer@example.com",
};

/**
 * 每个提交递增一分钟：既确定，又让各提交时间互不相同（否则没法验日期排序）。
 *
 * **每个仓库开始时归零**，这样三个仓库的共享历史会得到**完全相同的 commit hash**——
 * 否则形状虽然一样，时间戳不同，hash 也就不同，「共享同一段历史」就只是句空话，
 * 没法拿 base 的 hash 去 conflict 里对照。
 */
let clock = 0;
function resetClock() {
  clock = 0;
}
function nextDate() {
  const t = new Date(Date.UTC(2020, 0, 1, 0, clock++, 0));
  return `${t.toISOString().slice(0, 19).replace("T", " ")} +0000`;
}

function run(repo, args, extraEnv = {}) {
  return execFileSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, ...IDENTITY, ...extraEnv },
  });
}

function commit(repo, message) {
  const date = nextDate();
  run(repo, ["add", "-A"]);
  // 消息走 stdin 而非 -m：-m 传不了控制字符（见「奇异消息」那条提交）。
  // --cleanup=verbatim 关掉 git 默认的消息清理，否则控制字符与空行会被动。
  execFileSync("git", ["commit", "-q", "--file=-", "--cleanup=verbatim"], {
    cwd: repo,
    input: message,
    env: { ...process.env, ...IDENTITY, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  });
}

function write(repo, name, content) {
  writeFileSync(join(repo, name), content, "utf8");
}

function remove(repo, name) {
  unlinkSync(join(repo, name));
}

function rename(repo, from, to) {
  renameSync(join(repo, from), join(repo, to));
}

/** 建一个空仓库。`-b main` 固定初始分支名，不受用户 init.defaultBranch 影响。 */
function initRepo(name) {
  const repo = join(outDir, name);
  mkdirSync(repo, { recursive: true });
  run(repo, ["init", "-q", "-b", "main"]);
  resetClock();
  return repo;
}

/**
 * 共享历史。三个仓库都从这里开始，保证提交图完全一致。
 *
 *   A(root) ─ B(中文) ─ C(多行消息) ─ D(奇异消息) ─ F(main) ─ M(merge)
 *                                        └───── E(feat) ────────┘
 */
function buildHistory(repo) {
  // ① 根提交：没有父提交。`%P` 会是空字符串。
  write(repo, "a.txt", "one\n");
  commit(repo, "root commit\n");

  // ② 中文文件名：不带 -z 时 git 输出 "\344\275\240..." 这种八进制转义。
  write(repo, "你好世界.txt", "hi\n");
  commit(repo, "add 中文文件名\n");

  // ③ 多行提交消息：分隔符方案要解决的核心问题——消息里有换行，
  //    所以「按换行切记录」的方案在这里就崩了。
  write(repo, "b.txt", "two\n");
  commit(repo, "subject line\n\nbody paragraph one.\nbody line two.\n");

  // ④ 奇异消息：含 \x01（RECORD_SEP 的第三个字节）、制表符、引号。
  //    \x01 单独出现是合法的，它只在紧跟两个 \x00 之后才构成记录分隔符——
  //    这条提交就是用来证明这一点的。NUL 本身不可能出现在提交消息里。
  write(repo, "c.txt", "three\n");
  commit(repo, 'weird \x01 SOH\tand "quotes"\n');

  // ⑤ merge 提交：`%P` 里有两个 hash，空格分隔。
  run(repo, ["checkout", "-q", "-b", "feat"]);
  write(repo, "f.txt", "feat\n");
  commit(repo, "on feat\n");

  run(repo, ["checkout", "-q", "main"]);
  write(repo, "m.txt", "main\n");
  commit(repo, "on main\n");

  const mergeDate = nextDate();
  run(repo, ["merge", "-q", "--no-ff", "feat", "-m", "merge feat into main"], {
    GIT_AUTHOR_DATE: mergeDate,
    GIT_COMMITTER_DATE: mergeDate,
  });

  // ⑥ 两种 tag，给 parseRefs 用：
  //    轻量 tag 直接指向提交；附注 tag 是独立对象，需要多解一层才拿到提交。
  const tagDate = nextDate();
  run(repo, ["tag", "-a", "v1.0", "-m", "release one"], {
    GIT_AUTHOR_DATE: tagDate,
    GIT_COMMITTER_DATE: tagDate,
  });
  run(repo, ["tag", "lightweight"]);

  // ⑦ 改名，给 parseNameStatus 用。改名是它唯一的新逻辑：
  //    `R100\0旧路径\0新路径`，比别的状态多带一个路径。
  //
  //    放在 tag 之后，v1.0 / lightweight 仍指向 merge 提交，refs 的测试不受影响。
  //    **不动 `你好世界.txt`**——buildBase 后面要拿它造「未提交的改名」状态。
  write(repo, "中文原名.txt", "zh\n");
  run(repo, ["mv", "m.txt", "renamed.txt"]);
  commit(repo, "rename m.txt and add 中文原名\n");

  // 两侧都是非 ASCII，且新名字里有空格与中点——证明路径是原始 UTF-8 字节、
  // 不转义、也不能按空格切。
  run(repo, ["mv", "中文原名.txt", "中文 新名·改.txt"]);
  commit(repo, "rename 中文文件名\n");
}

/** base：在共享历史之上留下各种未提交状态，给 parseStatus 用。 */
function buildBase() {
  const repo = initRepo("base");
  buildHistory(repo);

  write(repo, "a.txt", "one modified\n"); // 已跟踪、已改、未暂存   → ' M'
  write(repo, "staged.txt", "staged\n");
  run(repo, ["add", "staged.txt"]); //                             → 'A '
  write(repo, "untracked.txt", "untracked\n"); //                  → '?'
  write(repo, "未跟踪的中文.txt", "untracked cjk\n"); //             → '?'
  run(repo, ["rm", "-q", "--cached", "b.txt"]); //  从 index 删除   → 'D.' + '?'

  // 重命名：porcelain v2 里是记录类型 '2'，旧路径在**下一个 NUL 段**。
  // 用中文名，顺带覆盖「重命名 + 非 ASCII」的组合。
  run(repo, ["mv", "你好世界.txt", "改名后的中文.txt"]);

  // 路径含空格：v2 的字段用空格分隔，而路径**不加引号**——
  // 所以按空格切字段必须限定个数，剩下的整个是路径。不覆盖这条就试不出这个坑。
  write(repo, "有 空格 的文件.txt", "spaces in name\n");
  return repo;
}

/**
 * conflict：停在一次 merge 冲突中，且**七种未合并状态码一次全部覆盖**。
 *
 * git 的冲突码是 `XY` 两个字符，但在冲突状态下它们不再是「暂存区 / 工作区」两个
 * 独立维度，而是「我方 / 对方」的一对，必须整体消费——否则 'AA' 会被
 * `case 'A'` 在 X、Y 两个 switch 里各命中一次，同一文件出现两条记录。
 *
 *   DD  两边都删        AU  我方新增（对方无）    UD  对方删了、我方改了
 *   UA  对方新增（我方无）DU  我方删了、对方改了    AA  两边都新增
 *   UU  两边都改（最常见）
 *
 * 只用五个文件就能造出七种，关键在最后一个：
 * **改名冲突（rename/rename）一个文件产出三种码**——原路径两边都没了是 `DD`，
 * 我方的新名字只存在于我方是 `AU`，对方的新名字是 `UA`。
 * 这也解释了 `AU`/`UA` 的真实含义：不是「我们新建了个文件」，
 * 而是「这个路径只存在于未解决冲突的一侧」。
 */
function buildConflict() {
  const repo = initRepo("conflict");
  buildHistory(repo);

  // 合并基线：这四个文件在分岔之前就存在。
  // rename-me.txt 要给足内容，否则 git 的改名检测（按相似度）认不出来。
  write(repo, "uu.txt", "base\n");
  write(repo, "ud.txt", "base\n");
  write(repo, "du.txt", "base\n");
  write(repo, "rename-me.txt", "base content for rename detection\nline2\nline3\nline4\n");
  commit(repo, "conflict baseline\n");

  run(repo, ["checkout", "-q", "-b", "theirs"]);
  write(repo, "uu.txt", "theirs\n"); //                两边都改      → UU
  write(repo, "aa.txt", "theirs\n"); //                两边都新增    → AA
  remove(repo, "ud.txt"); //                           对方删        → UD
  write(repo, "du.txt", "theirs\n"); //                对方改        → DU
  rename(repo, "rename-me.txt", "theirs-name.txt"); // 改名冲突      → DD + UA
  commit(repo, "theirs side\n");

  run(repo, ["checkout", "-q", "main"]);
  write(repo, "uu.txt", "ours\n");
  write(repo, "aa.txt", "ours\n");
  write(repo, "ud.txt", "ours\n"); //                  我方改
  remove(repo, "du.txt"); //                           我方删
  rename(repo, "rename-me.txt", "ours-name.txt"); //   改名冲突      → AU
  commit(repo, "ours side\n");

  // 这次 merge 必定失败。execFileSync 遇非零退出码会抛，显式吞掉。
  try {
    run(repo, ["merge", "--no-ff", "theirs", "-m", "will conflict"]);
  } catch {
    /* 预期内：仓库现在停在冲突中，正是要的状态 */
  }
  return repo;
}

/**
 * tracking：带远程仓库，覆盖四种上游状态。
 *
 * `%(upstream:track)` 给的是人类可读串，四种形态都要能解析：
 *
 *   main       →  [ahead 2]              本地有、远程没有的提交
 *   behind     →  [behind 1]             远程有、本地没有的
 *   diverged   →  [ahead 1, behind 1]    两边都有
 *   gone       →  [gone]                 上游配置还在，但远程分支已被删
 *   no-upstream→  空串                    压根没配上游
 *
 * `gone` 是最容易漏的一种：它既不是「没有上游」，也不是某个 ahead/behind 数值。
 * 合并后删远程分支就会得到它，很常见。
 */
function buildTracking() {
  const remote = join(outDir, "remote.git");
  mkdirSync(remote, { recursive: true });
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote], { env: process.env });

  const repo = initRepo("tracking");
  write(repo, "a.txt", "one\n");
  commit(repo, "base\n");
  run(repo, ["remote", "add", "origin", remote]);

  // main：推上去之后再提交两条 → ahead 2
  run(repo, ["push", "-q", "-u", "origin", "main"]);
  write(repo, "a.txt", "two\n");
  commit(repo, "local only 1\n");
  write(repo, "a.txt", "three\n");
  commit(repo, "local only 2\n");

  // behind：推上去之后把本地退回一格 → behind 1
  run(repo, ["checkout", "-q", "-b", "behind"]);
  write(repo, "b.txt", "remote has this\n");
  commit(repo, "remote only\n");
  run(repo, ["push", "-q", "-u", "origin", "behind"]);
  run(repo, ["reset", "-q", "--hard", "HEAD~1"]);

  // diverged：推上去之后双方各走一步 → ahead 1, behind 1
  run(repo, ["checkout", "-q", "-b", "diverged", "main"]);
  run(repo, ["push", "-q", "-u", "origin", "diverged"]);
  write(repo, "c.txt", "remote side\n");
  commit(repo, "will be remote side\n");
  run(repo, ["push", "-q", "origin", "diverged"]);
  run(repo, ["reset", "-q", "--hard", "HEAD~1"]);
  write(repo, "d.txt", "local side\n");
  commit(repo, "local side\n");

  // gone：推上去建立跟踪，再从远程删掉 → 上游配置还在，远程分支没了
  run(repo, ["checkout", "-q", "-b", "gone", "main"]);
  run(repo, ["push", "-q", "-u", "origin", "gone"]);
  run(repo, ["push", "-q", "origin", "--delete", "gone"]);
  run(repo, ["fetch", "-q", "--prune", "origin"]);

  // synced：有上游且完全同步 → track 是空串。
  // 注意它和 no-upstream 的 track 都是空串，只能靠 %(upstream) 有没有值区分——
  // 这是最常见的状态，不覆盖的话 parser 很容易把「已同步」当成「没上游」。
  run(repo, ["checkout", "-q", "-b", "synced", "main"]);
  run(repo, ["push", "-q", "-u", "origin", "synced"]);

  // local-upstream：跟踪的是**本地分支**，不是远程分支。
  // git 把本地仓库表示成远程 `.`（配置里 branch.<n>.remote = .）。
  // 按 %(upstream) 的前缀去拆的写法会把这种当成「没有上游」，连 ahead/behind 一起丢掉。
  run(repo, ["checkout", "-q", "-b", "local-upstream", "main"]);
  write(repo, "local-upstream.txt", "ahead of a local branch\n");
  commit(repo, "ahead of local upstream\n");
  run(repo, ["branch", "-q", "--set-upstream-to=main", "local-upstream"]);

  // no-upstream：从没推过
  run(repo, ["checkout", "-q", "-b", "no-upstream", "main"]);

  run(repo, ["checkout", "-q", "main"]);
  return repo;
}

/** detached：HEAD 指向一个提交而非分支。`%D` 里不再有分支名。 */
function buildDetached() {
  const repo = initRepo("detached");
  buildHistory(repo);
  run(repo, ["checkout", "-q", "--detach", "HEAD~1"]);
  return repo;
}

/**
 * 带**真实签名**的提交。
 *
 * 为什么必须真签名：只把 `log.showSignature` 设成 true 来测是无效的——
 * 只把配置设成 true 然后跑，输出毫无变化，因为**未签名的提交不产生额外输出**。
 * 「跑了等于没跑」在输出上和「通过」长得一模一样。
 *
 * 用 ssh 签名（git ≥ 2.34）而不是 GPG：不需要密钥环、不需要交互、
 * `ssh-keygen` 到处都有。故意**不配** `gpg.ssh.allowedSignersFile`——
 * 验证失败反而让 git 多吐两行，正是我们要复现的破坏形态：
 *
 *   error: gpg.ssh.allowedSignersFile needs to be configured ...
 *   No signature
 *   <hash>...        ← 记录被顶到第三行，hash 字段整个错位
 */
function buildSigned() {
  const repo = initRepo("signed");
  const key = join(repo, "signing-key");
  execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", key, "-C", "fixture"], {
    stdio: "pipe",
  });
  run(repo, ["config", "gpg.format", "ssh"]);
  run(repo, ["config", "user.signingkey", `${key}.pub`]);
  run(repo, ["config", "commit.gpgsign", "true"]);
  // 密钥本身不能进历史，否则 status 里会多出两个文件
  writeFileSync(join(repo, ".gitignore"), "signing-key\nsigning-key.pub\n");
  write(repo, "a.txt", "one\n");
  commit(repo, "signed commit\n");
  write(repo, "b.txt", "two\n");
  commit(repo, "second signed\n");
  return repo;
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const base = buildBase();
const conflict = buildConflict();
const detached = buildDetached();
const tracking = buildTracking();
const signed = buildSigned();

console.log(`fixture 仓库已生成于 ${outDir}\n`);
for (const repo of [base, conflict, detached, tracking, signed]) {
  console.log(`  ${repo}`);
}

/**
 * 自检：把 conflict 仓库实际产出的状态码打出来。
 *
 * 这不是断言——它不会让任何东西失败，只是把「七种齐不齐」摆在眼前。
 * 没有它的话，将来有人改了 buildConflict 或换了 git 版本导致某种码消失，
 * 要等到 parser 的映射表有分支从没被碰过才会发现，而那时已经无从追溯。
 */
const CONFLICT_CODES = ["DD", "AU", "UD", "UA", "DU", "AA", "UU"];
const seen = new Set(
  run(conflict, ["status", "--porcelain=v1", "-z"])
    .split("\0")
    .filter((record) => record.length >= 3)
    .map((record) => record.slice(0, 2)),
);

console.log("\n冲突状态码覆盖（conflict 仓库）：");
for (const code of CONFLICT_CODES) {
  console.log(`  ${code}  ${seen.has(code) ? "✅" : "❌ 缺失"}`);
}
