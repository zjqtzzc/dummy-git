# `features/` —— 按功能切分的模块

**约束（CLAUDE.md §A，由 lint 强制）：本目录禁止直接 import `git/`，必须经 `core/repository`。**

每个 feature 自注册 handler，`extension.ts` 只做装配（目标 < 150 行）。
