import { assertNever, DiffSideKind } from "@dummy-git/shared";
import * as vscode from "vscode";
import type { Repository } from "../core/repository.js";
import { getFileContent, getStageContent } from "../git/commands/index.js";
import type { ErrorGate } from "./errorGate.js";
import { parseRevisionUri, REVISION_SCHEME } from "./revisionUri.js";

/**
 * `dummygit:` URI 的内容由这里提供：diff 里「某个提交里的文件」「冲突时暂存区的一栏」「不存在」。
 *
 * 只读，不发任何变更事件：历史版本由 hash 唯一决定、永远不变；暂存区的一栏在冲突期间不变，
 * 解决后就没了（合并编辑器也就该关了）。
 *
 * ## 它是 VS Code 直接调用我们代码的入口
 *
 * 不经过 Router，所以读取失败要在这里交给错误关口：
 * 输出面板写全、弹通知；同时抛 `FileSystemError`，让编辑器里显示「无法读取」。
 */
class RevisionFileSystem implements vscode.FileSystemProvider {
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
        return this.read(uri, () =>
          this.repository.run(getFileContent, root, side.hash, side.path),
        );
      case DiffSideKind.Stage:
        // 标记已解决后这一栏就没了：还开着的合并编辑器再读会失败，照样交给错误关口。
        return this.read(uri, () =>
          this.repository.run(getStageContent, root, side.stage, side.path),
        );
      default:
        return assertNever(side, "RevisionFileSystem.readFile");
    }
  }

  private async read(uri: vscode.Uri, content: () => Promise<Uint8Array>): Promise<Uint8Array> {
    try {
      return await content();
    } catch (error) {
      this.errors.report(error);
      throw vscode.FileSystemError.Unavailable(uri);
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
