# `git/` —— 进程层与解析层

**约束（CLAUDE.md §A，由 lint 强制）：本目录禁止 import `vscode`。**

理由：这一层必须能在纯 node 下裸测。M2–M6 的全部测试是秒级 Vitest 测试，
而不是启动 VSCode 宿主的集成测试——旧仓库 git 层零测试，根因就是测试成本太高。

规划内容：`cli.ts`（M2）/ `parsers/`（M3）/ `errors.ts`（M4）/ `commands/`（后续）。
