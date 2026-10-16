import { release } from "node:os";
import { GitDomain } from "@dummy-git/shared";
import * as vscode from "vscode";
import type { GitCli } from "../git/cli.js";
import { LOCALE } from "../git/cli.js";
import { getGitVersion, type RepositoryLocation } from "../git/commands/index.js";
import type { GitLogger } from "../git/types.js";
import { briefGitCommand } from "../ipc/brief.js";
import { type Operations, tagged } from "../ipc/operation.js";

/**
 * 「输出」里的 Dummy Git（`CLAUDE.md` G）。带级别的频道：每行自带时间戳与级别，
 * 同时写进窗口的日志目录（`Developer: Open Extension Logs Folder`），重新加载窗口后还找得回。
 * 默认级别 info，低于它的不显示也不落盘。
 */
export function createLogChannel(): vscode.LogOutputChannel {
  return vscode.window.createOutputChannel("Dummy Git", { log: true });
}

/**
 * 把 `git/` 的日志接到频道上。
 *
 * `GitLogger` 只交出一条命令的记录（`GitCommandRecord`），写成什么样由这一层定：
 * `git/` 层不 import `vscode`（lint 强制），所以它只能声明形状，
 * 由这一层接到真正的出口上。换个宿主（CLI、测试脚本）换一个实现即可。
 */
export function createOutputLogger(channel: vscode.LogOutputChannel): GitLogger {
  return {
    // 在某个操作里跑的命令带上它的编号；启动、文件监听引起的不带。慢的记 warn。
    command: (record) => {
      const { line, slow } = briefGitCommand(record);
      if (slow) channel.warn(tagged(line));
      else channel.info(tagged(line));
    },
  };
}

/**
 * 运行环境，启动时记一次。出事后先看这几行：同一个问题只在某些机器上出，
 * 多半是 git 版本、远程类型（容器、SSH、WSL）或系统不同。
 * git 起不来时记下错误原文，不中断启动（后面找仓库时还会再报一次）。
 */
export async function logEnvironment(
  channel: vscode.LogOutputChannel,
  context: vscode.ExtensionContext,
  cli: GitCli,
  gitPath: string,
): Promise<void> {
  const extension: unknown = context.extension.packageJSON;
  const version =
    typeof extension === "object" && extension !== null && "version" in extension
      ? String(extension.version)
      : "?";
  let git: string;
  try {
    git = await getGitVersion.execute(cli, process.cwd());
  } catch (error) {
    git = `unavailable (${error instanceof Error ? error.message : String(error)})`;
  }
  channel.info(
    [
      `Dummy Git ${version}, VS Code ${vscode.version}`,
      `remote: ${vscode.env.remoteName ?? "local"}, ${process.platform} ${process.arch} ${release()}`,
      `git: ${git} at ${gitPath}, locale ${LOCALE}`,
    ].join(" | "),
  );
}

/** 找到的仓库，记一次。linked worktree 时 git 目录与共享目录不同，一起写上。 */
export function logRepository(
  channel: vscode.LogOutputChannel,
  location: RepositoryLocation,
): void {
  const shared = location.commonDir === location.gitDir ? "" : `, shared ${location.commonDir}`;
  channel.info(`Repository: ${location.root} (git dir ${location.gitDir}${shared})`);
}

/** 域在日志里的叫法（`CLAUDE.md` B.2：enum 值不拼进文字，经这张表）。 */
const DOMAIN_NAMES: Readonly<Record<GitDomain, string>> = {
  [GitDomain.Refs]: "分支与提交",
  [GitDomain.Worktree]: "工作区",
  [GitDomain.Stash]: "stash",
  [GitDomain.Operation]: "进行中的操作",
};

/**
 * 仓库变了、要刷新：记一行哪些域过期了，以及当时的操作情况（`Operations.context`）。
 * 之后各页面重新拉数据的请求按时间就挨在这行后面。
 */
export function logRefresh(
  channel: vscode.LogOutputChannel,
  domains: ReadonlySet<GitDomain>,
  operations: Operations,
): void {
  const names = Object.values(GitDomain)
    .filter((domain) => domains.has(domain))
    .map((domain) => DOMAIN_NAMES[domain]);
  const context = operations.context();
  channel.info(`刷新：${names.join("、")}${context === "" ? "" : `（${context}）`}`);
}
