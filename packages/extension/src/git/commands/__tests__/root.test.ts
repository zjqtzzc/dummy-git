import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupTempRepos, cli, makeTempRepo } from "../../../__tests__/support.js";
import { GitFailureError } from "../../failure.js";
import { getRepositoryRoot } from "../root.js";

afterEach(cleanupTempRepos);

describe("getRepositoryRoot：整条链路的第一环", () => {
  it("传仓库根目录本身", async () => {
    const repo = makeTempRepo("root-at-top");
    const root = await getRepositoryRoot.execute(cli, repo);
    // realpathSync 是因为 /tmp 在部分平台是符号链接（如 macOS 的 /private/tmp）
    const { realpathSync } = await import("node:fs");
    expect(root).toBe(realpathSync(repo));
  });

  it("传仓库子目录，仍能找到根——不能靠找 ./.git 硬编码", async () => {
    const repo = makeTempRepo("root-from-subdir");
    const deep = join(repo, "src", "deep");
    mkdirSync(deep, { recursive: true });
    const { realpathSync } = await import("node:fs");
    const root = await getRepositoryRoot.execute(cli, deep);
    expect(root).toBe(realpathSync(repo));
  });

  it("不是仓库 → 抛 GitFailureError（code: NotAGitRepository）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "not-a-repo-"));
    await expect(getRepositoryRoot.execute(cli, dir)).rejects.toBeInstanceOf(GitFailureError);
  });
});
