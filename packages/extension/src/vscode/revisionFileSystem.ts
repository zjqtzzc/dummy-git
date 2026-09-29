import { assertNever, DiffSideKind } from "@dummy-git/shared";
import * as vscode from "vscode";
import type { Repository } from "../core/repository.js";
import { getFileContent } from "../git/commands/index.js";
import type { ErrorGate } from "./errorGate.js";
import { parseRevisionUri, REVISION_SCHEME } from "./revisionUri.js";

/**
 * `dummygit:` URI 的内容由这里提供：diff 里「某个提交里的文件」「不存在」两种边。
 *
 * 只读。历史版本的内容由 hash 唯一决定、永远不变，所以不发任何变更事件。
 *
 * ## 它是 VS Code 直接调用我们代码的入口
 *
 * 不经过 Router，所以读取失败要在这里交给错误关口（`ARCHITECTURE.md` 第 15 题）：
 * 输出面板写全、弹通知；同时抛 `FileSystemError`，让编辑器里显示「无法读取」。
 */
export class RevisionFileSystem implements vscode.FileSystemProvider {
  private readonly changes = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.changes.event;

  constructor(
    private readonly repository: Repository,
    private readonly errors: ErrorGate,
  ) {}

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const root = this.repository.location.root;
    const side = parseRevisionUri(root, uri.fsPath, uri.query);
    if (side === undefined) throw vscode.FileSystemError.FileNotFound(uri);

    switch (side.kind) {
      case DiffSideKind.Missing:
        return new Uint8Array();
      case DiffSideKind.Revision:
        try {
          return await this.repository.run(getFileContent, root, side.hash, side.path);
        } catch (error) {
          this.errors.report(error);
          throw vscode.FileSystemError.Unavailable(uri);
        }
      default:
        return assertNever(side, "RevisionFileSystem.readFile");
    }
  }

  stat(uri: vscode.Uri): vscode.FileStat {
    // 大小不知道也不必知道：VS Code 打开时照样调 readFile。
    // 时间给 0：内容不随时间变。
    if (parseRevisionUri(this.repository.location.root, uri.fsPath, uri.query) === undefined) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    return { type: vscode.FileType.File, ctime: 0, mtime: 0, size: 0 };
  }

  watch(): vscode.Disposable {
    // 内容永远不变，没有什么可监听的。
    return new vscode.Disposable(() => {});
  }

  readDirectory(): never {
    throw vscode.FileSystemError.NoPermissions("dummygit: read-only, no directories");
  }

  createDirectory(): never {
    throw vscode.FileSystemError.NoPermissions("dummygit: read-only");
  }

  writeFile(): never {
    throw vscode.FileSystemError.NoPermissions("dummygit: read-only");
  }

  delete(): never {
    throw vscode.FileSystemError.NoPermissions("dummygit: read-only");
  }

  rename(): never {
    throw vscode.FileSystemError.NoPermissions("dummygit: read-only");
  }
}

/** 注册到 VS Code。`isCaseSensitive`：git 的路径区分大小写。 */
export function registerRevisionFileSystem(
  repository: Repository,
  errors: ErrorGate,
): vscode.Disposable {
  return vscode.workspace.registerFileSystemProvider(
    REVISION_SCHEME,
    new RevisionFileSystem(repository, errors),
    { isReadonly: true, isCaseSensitive: true },
  );
}
