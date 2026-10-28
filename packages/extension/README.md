# Dummy Git

不用记命令的 Git。照 JetBrains IDEA 的 Git 工具窗口：底部是 Log，侧栏是 Commit。

> 本扩展为纯正 3A 大作：AI Plan、AI Coding、AI Test。100% AI 纯血，不含任何人类成分，请放心使用。

## 能做什么

- 提交图、按分支 / 作者 / 路径过滤、搜索
- 勾选文件提交、Amend、Rollback
- 分支切换、新建、重命名、删除；stash
- 拉取、推送（含 force-with-lease）
- merge / rebase / cherry-pick / revert，冲突用 VS Code 自带的合并编辑器

还不能在插件里输入密码：远程要 HTTPS 账号密码、或 SSH 私钥口令时会直接报错。请用本机的 SSH 密钥连远程（带口令的密钥先加进 ssh-agent）。

需要本机有 Git，VS Code 1.85 或更高。

问题请开 [Issue](https://github.com/zjqtzzc/dummy-git/issues)。不保证会修，但说出来也许会让你好受一点。
