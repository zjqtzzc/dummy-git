import { type CommitFileChange, FileStatus } from "@dummy-git/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { cli, fixtures } from "../../../__tests__/support.js";
import { GitParseError } from "../errors.js";
import { commitFilesArgs, parseNameStatus } from "../nameStatus.js";

/** 走真实路径：`cli.execRaw` → `parseNameStatus`，与生产代码同一条链。 */
async function filesOf(repo: string, hash: string): Promise<CommitFileChange[]> {
  const r = await cli.execRaw(commitFilesArgs(hash), { cwd: repo });
  return parseNameStatus(r.stdout, hash);
}

/** 按提交标题找 hash。比写死 hash 稳——fixture 加一条提交不会让测试全挂。 */
async function hashOf(repo: string, subject: string): Promise<string> {
  const r = await cli.exec(["log", "--all", "--format=%H%x00%s"], { cwd: repo });
  for (const line of r.stdout.split("\n")) {
    const [hash, s] = line.split("\0");
    if (s === subject && hash !== undefined) return hash;
  }
  throw new Error(`fixture 里找不到标题为 ${JSON.stringify(subject)} 的提交`);
}

describe("parseNameStatus", () => {
  let renameCommit: string;
  let zhRenameCommit: string;

  beforeAll(async () => {
    renameCommit = await hashOf(fixtures.base, "rename m.txt and add 中文原名");
    zhRenameCommit = await hashOf(fixtures.base, "rename 中文文件名");
  });

  it("改名带旧路径，且与新增混在同一条提交里也不错位", async () => {
    // 改名是 `R100\0旧\0新`——比别的状态**多一个路径**。数错就会把下一条记录的
    // 状态码当成路径，而那之后每一条都是错的，且每个字段仍然是合法字符串。
    const files = await filesOf(fixtures.base, renameCommit);

    expect(files).toEqual([
      { status: FileStatus.Renamed, oldPath: "m.txt", path: "renamed.txt" },
      { status: FileStatus.Added, path: "中文原名.txt" },
    ]);
  });

  it("两侧都是非 ASCII 的改名，原样输出，不转义也不按空格切", async () => {
    const files = await filesOf(fixtures.base, zhRenameCommit);

    expect(files).toEqual([
      { status: FileStatus.Renamed, oldPath: "中文原名.txt", path: "中文 新名·改.txt" },
    ]);
  });

  it("用户设了 diff.renames=false 时，改名仍然是改名（靠 -M 覆盖）", async () => {
    // 不加 `-M` 的话，一次改名会退化成 `D` + `A` 两条，改名关系彻底丢失。
    // 这类「用户配置改变我们的输出」的坑与 `log.showSignature` 同源，
    // 本地默认配置下永远复现不了。
    const args = ["-c", "diff.renames=false", ...commitFilesArgs(zhRenameCommit)];
    const r = await cli.execRaw(args, { cwd: fixtures.base });

    expect(parseNameStatus(r.stdout, zhRenameCommit)).toEqual([
      { status: FileStatus.Renamed, oldPath: "中文原名.txt", path: "中文 新名·改.txt" },
    ]);
  });

  it("根提交能列出文件——它没有父提交，也不需要 --root", async () => {
    // 用 `diff <hash>^ <hash>` 取文件的话，根提交没有 `^`，
    // 命令直接失败，界面上根提交永远是空的。
    // 走 `git log --name-status` 就不需要引用父提交，那一整类 bug 不可能发生。
    const r = await cli.exec(["rev-list", "--max-parents=0", "HEAD"], { cwd: fixtures.base });
    const root = r.stdout.trim();

    const files = await filesOf(fixtures.base, root);
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((f) => f.status === FileStatus.Added)).toBe(true);
  });

  it("merge 提交不是空的——靠 --first-parent", async () => {
    // git 默认不给 merge 提交出 diff，实测输出是**零字节**。
    // 不加 `--first-parent` 的话，界面上点开一个合并提交什么都看不到。
    const merge = await hashOf(fixtures.base, "merge feat into main");

    const withFirstParent = await filesOf(fixtures.base, merge);
    expect(withFirstParent.length).toBeGreaterThan(0);

    // 对照组：去掉 --first-parent，证明这个开关确实是必需的，不是顺手加的。
    const bare = commitFilesArgs(merge).filter((a) => a !== "--first-parent");
    const r = await cli.execRaw(bare, { cwd: fixtures.base });
    expect(parseNameStatus(r.stdout, merge)).toEqual([]);
  });

  it("签名提交不污染输出——靠 -c log.showSignature=false", async () => {
    // 用户开了 `log.showSignature=true` 时，git 会在输出前插一行
    // `Good "git" signature for …`，第一个「状态」读到的就是它。
    const r = await cli.exec(["log", "-1", "--format=%H"], { cwd: fixtures.signed });
    const signed = r.stdout.trim();

    const args = ["-c", "log.showSignature=true", ...commitFilesArgs(signed)];
    const raw = await cli.execRaw(args, { cwd: fixtures.signed });

    expect(() => parseNameStatus(raw.stdout, signed)).not.toThrow();
    expect(parseNameStatus(raw.stdout, signed).length).toBeGreaterThan(0);
  });

  it("未知状态码抛错，不静默跳过", () => {
    // 认不出就是认不出。给未知码加一个 `Unknown` 变体会让解析层的事故
    // 变成数据结构里的合法状态，每个消费者都得处理它（`parsers/errors.ts` 的理由）。
    const bogus = Buffer.from("Z\0some/path\0", "utf8");

    expect(() => parseNameStatus(bogus, "deadbeef")).toThrow(GitParseError);
    expect(() => parseNameStatus(bogus, "deadbeef")).toThrow(/未知的状态码/);
  });

  it("空输出得到空数组，不是崩溃", () => {
    expect(parseNameStatus(Buffer.alloc(0), "deadbeef")).toEqual([]);
  });
});
