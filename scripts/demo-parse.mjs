#!/usr/bin/env node
/**
 * 把 parser 的输入和输出并排打出来看。
 *
 *   node scripts/demo-parse.mjs              跑全部
 *   node scripts/demo-parse.mjs log          只跑 log
 *   node scripts/demo-parse.mjs log base     只跑 base 仓库的 log
 *
 * **这不是测试**——正确性由 `git/parsers/__tests__/{scan,log,refs,status}.test.ts`
 * 断言，这个脚本不重复那件事。它存在的理由是测试给不了的东西：
 * **把原始字节摆在人眼前**，用于调试或理解 parser 到底在做什么。
 *
 * 每个 parser 打三段：
 *   ① 实际执行的 git 命令（可以直接复制到终端重跑）
 *   ② 原始字节，不可见字符标出来（`␀` = NUL，`␁` = SOH，`␊` = 换行）
 *   ③ 解析结果
 *
 * ② 是关键：parser 的 bug 几乎全在「我以为 git 这么输出」和「git 实际这么输出」
 * 的差距里，只看解析结果看不出来。
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const FIXTURES = join(ROOT, ".tmp", "fixtures");
const PARSERS_DIR = join(ROOT, "packages/extension/src/git/parsers");

/** 原始字节最多显示多少——够看清格式，又不会刷屏。 */
const RAW_LIMIT = 420;

const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const OFF = "\x1b[0m";

/**
 * 在不劈坏多字节字符的前提下截断。
 *
 * 直接 `subarray(0, n).toString("utf8")` 会把跨越边界的汉字切成两半，显示成替换字符——
 * 正是 parser 在字节层切分要防的那件事。UTF-8 的续接字节都是 `10xxxxxx`（0x80-0xBF），
 * 往回退到不是续接字节的位置即可。
 */
function truncate(buf, limit) {
  if (buf.length <= limit) return buf;
  let end = limit;
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end--;
  return buf.subarray(0, end);
}

/** 把不可见字符显示出来。光看解析结果发现不了分隔符层面的问题。 */
function visible(text) {
  return text
    .replaceAll("\0", `${YELLOW}␀${OFF}`)
    .replaceAll("\x01", `${YELLOW}␁${OFF}`)
    .replaceAll("\n", `${DIM}␊${OFF}\n`)
    .replaceAll("\t", `${DIM}␉${OFF}`);
}

/** TS 源码不能直接 import，用 esbuild 打包到临时目录再加载。 */
async function loadParsers(outDir) {
  const outfile = join(outDir, "parsers.mjs");
  await build({
    entryPoints: [join(PARSERS_DIR, "index.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile,
    logLevel: "error",
  });
  return import(outfile);
}

/**
 * 要跑的 demo。新增 parser 时在这里加一条即可。
 *
 * - `repos`：在哪些 fixture 仓库上跑。不同 parser 关心的仓库不同——
 *   `status` 要看 conflict，`refs` 要看 detached。
 */
function demos(parsers) {
  return [
    {
      name: "skeleton",
      repos: ["base", "tracking"],
      args: () => parsers.skeletonArgs(),
      parse: (stdout) => parsers.parseSkeleton(stdout),
      render: (rows) =>
        [`${DIM}全量 ${rows.length} 条（画图只要这三个字段）${OFF}`].concat(
          rows.map(
            (r) =>
              `${CYAN}${r.hash.slice(0, 7)}${OFF} 父[${r.parents.map((p) => p.slice(0, 7)).join(" ") || "—"}] ${r.at}`,
          ),
        ),
    },
    {
      name: "details",
      repos: ["base"],
      // 模型 B：先拿骨架，再按 hash 取可见那几行的详情。这里取前三条演示。
      command: (repo) => {
        const skeleton = parsers.parseSkeleton(run(repo, parsers.skeletonArgs()));
        return parsers.detailsArgs(skeleton.slice(0, 3).map((r) => r.hash));
      },
      parse: (stdout) => parsers.parseLog(stdout),
      render: (commits) =>
        commits.map(
          (c) =>
            `${CYAN}${c.hash.slice(0, 7)}${OFF} 父${c.parents.length}` +
            ` ${c.author.name} <${c.author.email}> ${c.author.at}` +
            `\n        ${JSON.stringify(c.message)}`,
        ),
    },
    {
      name: "status",
      repos: ["base", "conflict"],
      args: () => parsers.statusArgs(),
      env: parsers.STATUS_ENV,
      parse: (stdout) => parsers.parseStatus(stdout),
      render: (changes) =>
        changes.map((c) => {
          const detail =
            c.kind === "conflict"
              ? `${CYAN}${c.conflict}${OFF}`
              : c.kind === "untracked"
                ? `${CYAN}untracked${OFF}`
                : `暂存=${c.index} 工作区=${c.worktree}` +
                  (c.oldPath === undefined ? "" : ` ${DIM}← ${c.oldPath}${OFF}`);
          return `${c.path.padEnd(22)} ${detail}`;
        }),
    },
    {
      name: "refs",
      repos: ["base", "tracking", "detached"],
      args: () => parsers.refsArgs(),
      parse: (stdout) => parsers.parseRefs(stdout),
      render: (refs) =>
        refs.map((r) => {
          const head = `${CYAN}${r.kind}${OFF}`.padEnd(30);
          if (r.kind === "remoteBranch")
            return `${head} ${r.remote}/${r.name}  ${DIM}${r.target.slice(0, 7)}${OFF}`;
          if (r.kind === "tag")
            return (
              `${head} ${r.name}  ${DIM}${r.target.slice(0, 7)}${OFF}` +
              (r.annotated ? `  ${YELLOW}附注${OFF}` : "  轻量")
            );
          const u = r.upstream;
          const track =
            u === undefined
              ? `${DIM}无上游${OFF}`
              : u.state.kind === "gone"
                ? `${u.remote}/${u.name} ${YELLOW}[gone]${OFF}`
                : `${u.remote}/${u.name} ahead=${u.state.ahead} behind=${u.state.behind}`;
          return `${head} ${r.name}  ${DIM}${r.target.slice(0, 7)}${OFF}  ${track}`;
        }),
    },
    {
      name: "head",
      repos: ["base", "detached"],
      args: () => parsers.headArgs(),
      parse: (stdout) => [parsers.parseHead(stdout)],
      render: (refs) =>
        refs.map(
          (r) =>
            `${CYAN}${r.kind}${OFF} ${r.target.slice(0, 7)} ` +
            (r.branch === undefined ? `${YELLOW}detached${OFF}` : `分支=${r.branch}`),
        ),
    },
  ];
}

function run(repo, args, env, input) {
  return execFileSync("git", args, {
    cwd: repo,
    maxBuffer: 1 << 28,
    env: { ...process.env, ...env },
    ...(input === undefined ? {} : { input }),
  });
}

async function main() {
  if (!existsSync(FIXTURES)) {
    console.error(`找不到 ${FIXTURES}，先跑 node scripts/fixture.mjs`);
    process.exit(1);
  }
  const [wantParser, wantRepo] = process.argv.slice(2);

  const outDir = mkdtempSync(join(tmpdir(), "dummy-git-demo-"));
  try {
    const parsers = await loadParsers(outDir);

    for (const demo of demos(parsers)) {
      if (wantParser !== undefined && demo.name !== wantParser) continue;

      for (const repoName of demo.repos) {
        if (wantRepo !== undefined && repoName !== wantRepo) continue;
        const repo = join(FIXTURES, repoName);

        console.log(`\n${BOLD}══ ${demo.name} · ${repoName} ══${OFF}`);
        // 两种形态：只有参数，或参数 + stdin 输入（模型 B 的按 hash 取详情）。
        const command = demo.command === undefined ? { args: demo.args() } : demo.command(repo);
        console.log(`\n${DIM}$ git ${command.args.join(" ")}${OFF}`);
        if (command.input !== undefined) {
          console.log(`${DIM}  stdin: ${JSON.stringify(command.input)}${OFF}`);
        }

        const stdout = run(repo, command.args, demo.env, command.input);
        const shown = truncate(stdout, RAW_LIMIT);
        const omitted =
          stdout.length > shown.length ? `${DIM}…（共 ${stdout.length} 字节）${OFF}` : "";
        console.log(`\n${BOLD}原始输出${OFF}\n${visible(shown.toString("utf8"))}${omitted}`);

        console.log(`\n${BOLD}解析结果${OFF}`);
        try {
          for (const line of demo.render(demo.parse(stdout))) console.log(`  ${line}`);
        } catch (error) {
          // 解析失败也是有用的输出——这里正是要看 GitParseError 的诊断够不够用。
          console.log(`${RED}${error instanceof Error ? error.message : String(error)}${OFF}`);
        }
      }
    }
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

await main();
