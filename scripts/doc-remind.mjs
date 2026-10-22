#!/usr/bin/env node
/**
 * 改完代码，列出可能要跟着改的文档行。只提醒，不拦，不改任何东西。
 *
 * 为什么要有：文档里写着代码的路径与名字（「改 `ui/ToolButton.vue` 前先读本文」「见 `AUTO_FETCH_INTERVAL_MS`」），
 * 代码挪位置、改名、删东西之后，这些地方不会让任何检查变红，只会悄悄过时。
 * 线索怎么找、为什么这样取舍，见 `doc-remind/clues.mjs` 的文件头；这里只管读文档、跑 git、输入输出。
 *
 * 搜的文档：`docs/` 下的 `.md`（不含 `docs/refs/`，那是参照项目的笔记，不描述我们的代码）与根目录的 `CLAUDE.md`。
 *
 * 两种用法：
 *
 *   node scripts/doc-remind.mjs --hook
 *     Claude Code 的 PostToolUse Hook（匹配 Edit|Write）。stdin 是 Hook 的 JSON：
 *     刚改的文件在 `tool_input.file_path`，会话在 `session_id`；仓库根取 `CLAUDE_PROJECT_DIR`，没有就用本脚本所在的仓库。
 *     只看 `packages/` 下的文件。有线索时 stdout 只有一段 JSON（`additionalContext` 交给会话），没有就什么都不打。
 *     任何情况都退出 0、不写 stderr：非 0 退出码会被当成 Hook 出错显示给用户，提醒不该打扰。
 *     同一会话、同一文件，线索和上次一样就不再打印——连着改同一个文件时，同一段提醒不必一遍遍塞进上下文。
 *     上次的线索记在 `.tmp/doc-remind/<会话>/` 下，每个文件一份，并发的 Hook 不会互相覆盖。
 *
 *   node scripts/doc-remind.mjs        （pnpm docs:remind）
 *     看整个工作区未提交的改动：相对 HEAD 的 diff（改动的若是文档本身，跳过），加上 `packages/` 下未跟踪的文件。
 *     按文件分组打印给人看的文字，退出 0：这是提醒，不是检查。
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { deletedNames, findClues, formatClues } from "./doc-remind/clues.mjs";

const SCRIPT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const toPosix = (path) => path.split(sep).join("/");

/** stderr 收进管道而不是继承：Hook 不能往终端漏东西；手动用时出错，抛出的异常里带着 git 的 stderr。 */
function git(root, args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

const splitZ = (out) => out.split("\0").filter((p) => p !== "");

/** 文档本身：被搜的那些，以及 `docs/refs/`。 */
const isDoc = (path) => path === "CLAUDE.md" || (path.startsWith("docs/") && path.endsWith(".md"));

function readDocs(root) {
  const docs = [];
  const walk = (dir) => {
    for (const entry of readdirSync(join(root, dir)).sort()) {
      const path = `${dir}/${entry}`;
      if (path === "docs/refs") continue;
      if (statSync(join(root, path)).isDirectory()) walk(path);
      else if (entry.endsWith(".md")) docs.push(path);
    }
  };
  if (existsSync(join(root, "CLAUDE.md"))) docs.push("CLAUDE.md");
  if (existsSync(join(root, "docs"))) walk("docs");
  return docs.map((path) => ({ path, lines: readFileSync(join(root, path), "utf8").split("\n") }));
}

/** 仓库里（已跟踪的与未忽略的未跟踪文件）每个文件名出现几次，判断光写文件名有没有歧义。 */
function basenameCounts(root) {
  const counts = new Map();
  for (const path of splitZ(
    git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]),
  )) {
    const name = path.slice(path.lastIndexOf("/") + 1);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}

/** 一个文件的线索文字。`-U0`：只要删掉与加上的行，不要上下文行。新文件没有 HEAD 版本，diff 里没有删除行，只剩第 1 类。 */
function cluesFor(root, file, docs, counts) {
  const diff = git(root, ["diff", "HEAD", "--no-color", "--no-ext-diff", "-U0", "--", file]);
  return formatClues(file, findClues(file, deletedNames(diff), docs, counts));
}

async function hook() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const event = JSON.parse(input);
  const filePath = event?.tool_input?.file_path;
  if (typeof filePath !== "string") return;

  const root = process.env.CLAUDE_PROJECT_DIR || SCRIPT_ROOT;
  const rel = relative(root, resolve(root, filePath));
  if (rel.startsWith("..") || isAbsolute(rel)) return;
  const file = toPosix(rel);
  if (!file.startsWith("packages/")) return;

  const text = cluesFor(root, file, readDocs(root), basenameCounts(root));

  const session = event?.session_id;
  if (typeof session === "string" && session !== "") {
    const dir = join(root, ".tmp", "doc-remind", session.replace(/[^A-Za-z0-9_-]/g, "_"));
    const record = join(dir, createHash("sha1").update(file).digest("hex"));
    const last = existsSync(record) ? readFileSync(record, "utf8") : null;
    mkdirSync(dir, { recursive: true });
    writeFileSync(record, text);
    if (text === last) return;
  }
  if (text === "") return;

  const output = { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: text } };
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

function report() {
  const root = process.env.CLAUDE_PROJECT_DIR || SCRIPT_ROOT;
  // --no-renames：改名拆成「删旧路径 + 加新路径」，旧路径的整份删除行与提到旧路径的文档才不会漏。
  const changed = splitZ(git(root, ["diff", "HEAD", "--name-only", "--no-renames", "-z"]));
  const untracked = splitZ(
    git(root, ["ls-files", "-z", "--others", "--exclude-standard", "--", "packages"]),
  );
  const files = [...new Set([...changed, ...untracked])].filter((f) => !isDoc(f)).sort();
  if (files.length === 0) {
    console.log("没有未提交的代码改动。");
    return;
  }

  const docs = readDocs(root);
  const counts = basenameCounts(root);
  const blocks = files.map((file) => cluesFor(root, file, docs, counts)).filter((t) => t !== "");
  if (blocks.length === 0) {
    console.log(`看了 ${files.length} 个改动的文件，没有文档提到它们或其中删改的名字。`);
    return;
  }
  console.log(blocks.join("\n\n"));
}

if (process.argv.includes("--hook")) {
  // Hook 只提醒：任何错误都吞掉，退出码保持 0。stdout 只在最后写一次，出错时不会留下半截 JSON。
  // 不调 process.exit：写管道在有的平台上是异步的，立刻退出可能把刚写的输出截掉。
  hook().catch(() => {});
} else {
  report();
}
