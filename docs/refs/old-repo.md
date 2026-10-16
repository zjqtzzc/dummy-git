# 旧仓库考古：jetbrains-git-graph v0.5.4

> 来源：`~/Projects/jetbrains-git-graph`，266 commits（87 feat / 122 fix），
> 扩展 ID `zjqtzzc.make-git-great-again`。**只读，永不过期**——
> 它描述的是旧仓库在某一时刻的样子，不随本项目演进而改变。
>
> 拆分自原 `FEATURES.md` 的 §8/§9（2026-09-21，该文件已拆解，不再存在），编号重排为 §1/§2。
> 同源的另两份是活文档：`BACKLOG.md`（功能清单）、`tech/traps.md`（踩坑表）。

---

## 1. 已知缺陷与债务（新项目要主动解决）

1. **协议漂移**：`shared/protocol.ts` 自称"唯一来源"，但实际注册了 91 个 handler，
   其中 13 个不在 `CommandType` 里：
   `checkoutCommit` `cherryPick` `cherryPickFileChanges` `copyToClipboard`
   `createTag` `openFileAtRevision` `resetToCommit` `revertCommit`
   `revertFileChanges` `showConfirmMessage` `showInputBox` `showShelfFileDiff`
   `unshelveFile`
   → 新项目必须让协议**编译期强制**，漏注册/多注册都要报错。
2. **`extension.ts` 是上帝文件**：1720 行，91 个 handler 全在里面注册。
3. **缺状态机层**：`views/*Provider` 直接调 `gitService`，没有 vscode 那样的
   `Repository` 状态机，也没有操作队列。
4. **无 configuration**：一切硬编码。
5. **测试稀疏**：只有 4 个测试文件，且全在 webview 的工具函数上，git 层零测试。
6. **空壳 UI**：分支树设置菜单里 3 个"未实现"项对用户可见。

## 2. 值得原样继承的资产

不是所有东西都要重写：

- **`src/state/domains.ts`** —— git 状态分域（refs / worktree / stash / operation）
  的设计与文档质量很高，边界（"index 变化只算 worktree，否则 status→写index→重拉
  的回路"）是实打实的经验。**直接继承，只改实现不改概念。**
- **`src/git/gitService/parsers.ts`** —— log/refs/name-status/track 的解析，
  含 `\x00` 分隔符方案（`FIELD_SEP`/`RECORD_SEP`），是踩过坑的。抄，但补测试。
- **`src/git/graphLayout.ts` + `LaneSnapshot`** —— 分页续接车道状态的设计。
- **webview 交互设计**（不是代码）—— 右键菜单结构、快捷键、IDEA 视觉细节。
- **Seti 图标快照方案** —— 避开了依赖用户图标主题的坑。