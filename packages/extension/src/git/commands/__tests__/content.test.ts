import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupTempRepos, cli, git, makeTempRepo } from "../../../__tests__/support.js";
import { GitFailureError } from "../../failure.js";
import { getFileContent } from "../content.js";

afterEach(cleanupTempRepos);

describe("getFileContent：某个版本的文件原始字节", () => {
  it("读出指定版本的内容，不是工作区当前内容", async () => {
    const repo = makeTempRepo("content-rev");
    const first = git(repo, ["rev-parse", "HEAD"]).trim();
    writeFileSync(join(repo, "f1"), "changed\n");
    git(repo, ["commit", "-qam", "second"]);

    const old = await getFileContent.execute(cli, repo, first, "f1");
    expect(old.toString("utf8")).toBe("a\n");
  });

  it("--filters 做与检出相同的换行转换：eol=crlf 时读出 CRLF", async () => {
    // 仓库里存的是 LF；检出到工作区是 CRLF。不加 --filters 读到的是 LF，
    // 与工作区比较时整个文件每一行都会显示成改动。
    const repo = makeTempRepo("content-eol");
    writeFileSync(join(repo, ".gitattributes"), "*.txt text eol=crlf\n");
    writeFileSync(join(repo, "a.txt"), "one\ntwo\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-qm", "eol"]);

    const filtered = await getFileContent.execute(cli, repo, "HEAD", "a.txt");
    expect(filtered.toString("utf8")).toBe("one\r\ntwo\r\n");
    expect(git(repo, ["cat-file", "-p", "HEAD:a.txt"])).toBe("one\ntwo\n");
  });

  it("返回原始字节：非 UTF-8 内容原样保留", async () => {
    // GBK 的「中」是 0xD6 0xD0。解码交给 VS Code，这里一个字节都不能动。
    const repo = makeTempRepo("content-bytes");
    const gbk = Buffer.from([0xd6, 0xd0, 0x0a]);
    writeFileSync(join(repo, "gbk.txt"), gbk);
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-qm", "gbk"]);

    expect(await getFileContent.execute(cli, repo, "HEAD", "gbk.txt")).toEqual(gbk);
  });

  it("文件在这个版本里不存在 → GitFailureError", async () => {
    const repo = makeTempRepo("content-missing");
    await expect(getFileContent.execute(cli, repo, "HEAD", "nope")).rejects.toBeInstanceOf(
      GitFailureError,
    );
  });
});
