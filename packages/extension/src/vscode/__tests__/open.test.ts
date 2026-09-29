import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cli, fixtures } from "../../__tests__/support.js";
import { isNotARepository, openRepository } from "../open.js";

describe("openRepository", () => {
  it("传仓库根目录，得到同一个根", async () => {
    const repo = await openRepository(cli, fixtures.base);
    expect(repo.location.root).toBe(fixtures.base);
    repo.dispose();
  });

  it("传子目录也能找到根——不能靠找 ./.git 硬编码", async () => {
    // worktree 与 submodule 的 `.git` 是**文件**不是目录，且可能在更上层。
    // 这个判断必须交给 git 自己做。
    const sub = join(fixtures.base, "sub");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(sub, { recursive: true });

    const repo = await openRepository(cli, sub);
    expect(repo.location.root).toBe(fixtures.base);
    repo.dispose();

    rmSync(sub, { recursive: true, force: true });
  });

  it("非仓库目录：抛错，且被认出是「这儿不是仓库」而不是故障", async () => {
    // 用户在一个非仓库目录里打开编辑器是**正常情况**，应该安静地什么都不做。
    // 与「git 不存在」「权限不足」必须分开——那些要报出来。
    const plain = mkdtempSync(join(tmpdir(), "dummy-git-not-a-repo-"));
    try {
      await expect(openRepository(cli, plain)).rejects.toSatisfy(isNotARepository);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });

  it("其他失败不会被误判成「不是仓库」", async () => {
    // 反向：isNotARepository 不能见错就点头，否则真故障会被当成正常情况咽掉。
    expect(isNotARepository(new Error("git 不存在"))).toBe(false);
    expect(isNotARepository(undefined)).toBe(false);
  });
});
