import * as vscode from "vscode";

/**
 * git 可执行文件的位置。
 *
 * ## 为什么这件事在 `vscode/` 层
 *
 * 探测它要读 VSCode 配置，所以在这里探测，再注入给 `new GitCli(gitPath)`。
 *
 * ## 目前只做最简的一档
 *
 * 读内置 git 扩展的 `git.path` 设置，没有就用 `"git"`（靠 PATH 找）。
 * 复用 `git.path` 而不是自己定义一个：用户为内置 git 配过一次，
 * 不该为了我们再配一次——这个设置在企业环境（自带 git 发行版）里是真的有人用。
 *
 * **没做的（不是遗漏）**：Windows 注册表、`xcode-select`、WSL、`.cmd` shim 的 caret 转义。
 * 等真有人报「找不到 git」再做，现在做等于给一个还没出现的问题写代码。
 */
export function resolveGitPath(): string {
  const configured = vscode.workspace.getConfiguration("git").get<string | string[]>("path");
  if (typeof configured === "string" && configured.length > 0) return configured;
  // `git.path` 允许配成数组（多个候选）。取第一个非空的，不做存在性探测——
  // 探不到的话第一条 git 命令自己会失败，那条错误比我们编的更准确。
  if (Array.isArray(configured)) {
    const first = configured.find((p) => typeof p === "string" && p.length > 0);
    if (first !== undefined) return first;
  }
  return "git";
}
