import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupTempRepos, cli, makeTempRepo } from "../../__tests__/support.js";
import { GitCli } from "../../git/cli.js";
import { discoverRepositories, StartupKind, type StartupResult } from "../open.js";

afterEach(cleanupTempRepos);

const plainDirs: string[] = [];
afterEach(() => {
  for (const dir of plainDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** 一个不在任何仓库里的目录。 */
function plainDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "dummygit-plain-"));
  plainDirs.push(dir);
  return dir;
}

/** 只看各仓库的根，位置对象的其余字段由 location 测试负责。 */
function roots(result: StartupResult): readonly string[] {
  return result.kind === StartupKind.Ready ? result.repositories.map((r) => r.root) : [];
}

describe("discoverRepositories：启动结果四选一", () => {
  it("没有打开任何目录 → NoFolder", async () => {
    expect(await discoverRepositories(cli, [])).toEqual({ kind: StartupKind.NoFolder });
  });

  it("目录都不在仓库里 → NoRepository（正常情况，不是故障）", async () => {
    expect(await discoverRepositories(cli, [plainDir(), plainDir()])).toEqual({
      kind: StartupKind.NoRepository,
    });
  });

  it("第一个目录不是仓库、第二个是 → 仍然找到仓库，不误报「没有仓库」", async () => {
    const repo = realpathSync(makeTempRepo("disc-second"));
    const result = await discoverRepositories(cli, [plainDir(), repo]);
    expect(result.kind).toBe(StartupKind.Ready);
    expect(roots(result)).toEqual([repo]);
  });

  it("同一仓库出现两次按根去重，顺序跟着目录走", async () => {
    const a = realpathSync(makeTempRepo("disc-a"));
    const b = realpathSync(makeTempRepo("disc-b"));
    const aSub = join(a, "src");
    mkdirSync(aSub);
    expect(roots(await discoverRepositories(cli, [b, aSub, a]))).toEqual([b, a]);
  });

  it("git 起不来 → GitUnavailable，带上原始原因", async () => {
    const broken = new GitCli("/nonexistent/git");
    const result = await discoverRepositories(broken, [plainDir()]);
    expect(result.kind).toBe(StartupKind.GitUnavailable);
    // 反向：git 不存在绝不能被当成「这里不是仓库」咽掉。
    expect(result).toMatchObject({ reason: expect.stringContaining("ENOENT") });
  });
});
