/**
 * 打开一个面板时，两侧到底来回发了什么。
 *
 *   pnpm demo:protocol [仓库路径]      # 默认当前目录
 *
 * 用 `vite-node` 而不是 `node --experimental-strip-types`：后者是 strip-only 模式，
 * 不支持 `constructor(private readonly x)` 这种参数属性，而代码里到处都是。
 *
 * 不是测试：没有断言，不进 `pnpm check`。测试断言的是**结果**，
 * 这里给的是**顺序**——F5 之后面板空白时，第一件事就是对照这份时序，
 * 看卡在哪一步（没握手？没问到仓库？请求发了没回？）。
 *
 * 跑的是真的 Router、真的 Client、真的 git 子进程，只把 `postMessage`
 * 换成两个直接互相调用的函数——那正是 VSCode 在中间做的事。
 */
import { existsSync } from "node:fs";
import { GitCli } from "../packages/extension/src/git/cli.ts";
import { createHandlers } from "../packages/extension/src/ipc/handlers.ts";
import { Router, type Transport } from "../packages/extension/src/ipc/router.ts";
import { openRepository } from "../packages/extension/src/vscode/open.ts";
import { Client, type ClientTransport } from "../packages/webview/src/client.ts";

const repoPath = process.argv[2] ?? process.cwd();
if (!existsSync(repoPath)) {
  // 不先检查的话，错误是 `spawn git ENOENT`——Node 对「找不到可执行文件」和
  // 「cwd 不存在」报同一个错，而它把人指向「git 装没装」，完全是错误方向。
  console.error(`目录不存在：${repoPath}`);
  process.exit(1);
}
const dim = (s: string): string => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string): string => `\x1b[1m${s}\x1b[0m`;

function show(direction: "→" | "←", message: unknown): void {
  const arrow = direction === "→" ? "webview → extension" : "extension → webview";
  const body = JSON.stringify(message, (_k, v) =>
    Array.isArray(v) && v.length > 3 ? `[${v.length} 条]` : v,
  );
  console.log(`  ${dim(arrow)}  ${body.length > 160 ? `${body.slice(0, 160)}…` : body}`);
}

const cli = new GitCli("git");
const repository = await openRepository(cli, repoPath);
console.log(`\n${bold("仓库")}：${repository.root}\n`);

// 把两侧接起来。VSCode 在真实运行时做的就是这件事，只不过中间隔着 postMessage。
let router: Router;
const toExtension: ClientTransport = {
  post: (m) => {
    show("→", m);
    router.receive(m);
  },
};
const client = new Client(toExtension, "demo-generation-1");
const toWebview: Transport = {
  post: (m) => {
    show("←", m);
    client.receive(m);
  },
};
router = new Router(toWebview, createHandlers(repository));

console.log(bold("① 握手——在这之前扩展侧一个字节都不发"));
client.start();

console.log(`\n${bold("② 前端主动要数据：先问有哪些仓库")}`);
const roots = await client.request("getRepositories", {});

console.log(`\n${bold("③ 拿到仓库，要历史骨架")}`);
const skeleton = await client.request("getSkeleton", { repo: roots[0] ?? "" });

console.log(`\n${bold("④ 只对要显示的那几条取详情（取数模型 B）")}`);
const hashes = skeleton.slice(0, 3).map((c) => c.hash);
const commits = await client.request("getCommitDetails", { repo: roots[0] ?? "", hashes });

console.log(`\n${bold("⑤ 点一条提交，要它改了哪些文件")}`);
const files = await client.request("getCommitFiles", {
  repo: roots[0] ?? "",
  hash: commits[0]?.hash ?? "",
});

console.log(`\n${bold("⑥ 仓库变了：只广播「哪些域过期」，不带数据")}`);
repository.onDidChange((domains) => router.broadcast(repository.root, [...domains]));
repository.notifyGitPath("HEAD");
repository.flushPending();

console.log(`\n${bold("结果")}`);
console.log(`  骨架 ${skeleton.length} 条，详情取了 ${commits.length} 条`);
console.log(`  第一条提交 ${commits[0]?.hash.slice(0, 8)} 改了 ${files.length} 个文件`);
console.log(
  dim("\n  广播里只有域名，没有提交数据——要不要重新拉由前端决定（DECISIONS.md 数据流向总原则）\n"),
);
repository.dispose();
