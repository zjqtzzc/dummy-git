import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupTempRepos, cli, git, makeTempRepo } from "../../../__tests__/support.js";
import { RewordOutcome, rewordCommit } from "../reword.js";

afterEach(cleanupTempRepos);

/** 一条提交的原文头部里，除提交者外的东西（tree、父提交个数、作者含时区）与说明。 */
const show = (repo: string, ref: string) => ({
  tree: git(repo, ["rev-parse", `${ref}^{tree}`]).trim(),
  author: git(repo, ["show", "-s", "--format=%an <%ae> %ad", "--date=raw", ref]).trim(),
  message: git(repo, ["show", "-s", "--format=%B", ref]),
});

/** init 之后再提交三条：one、two、three；作者时区各不相同，看得出是否原样保留。 */
function threeCommits(): { repo: string; one: string } {
  const repo = makeTempRepo("reword");
  const commit = (name: string, zone: string) => {
    writeFileSync(join(repo, `${name}.txt`), `${name}\n`);
    git(repo, ["add", "-A"]);
    execWithDate(repo, name, zone);
  };
  commit("one", "+0800");
  commit("two", "-0500");
  commit("three", "+0000");
  return { repo, one: git(repo, ["rev-parse", "HEAD~2"]).trim() };
}
function execWithDate(repo: string, message: string, zone: string): void {
  git(repo, [
    "-c",
    `user.name=${message}-author`,
    "commit",
    "-qm",
    message,
    `--date=1700000000 ${zone}`,
  ]);
}

describe("rewordCommit", () => {
  it("改 HEAD：只换说明，内容、父提交、作者不变；分支跟着动", async () => {
    const { repo } = threeCommits();
    const before = show(repo, "HEAD");
    const parent = git(repo, ["rev-parse", "HEAD~1"]).trim();
    const head = git(repo, ["rev-parse", "HEAD"]).trim();
    expect(await rewordCommit.execute(cli, repo, head, "THREE")).toBe(RewordOutcome.Reworded);
    expect(show(repo, "HEAD")).toEqual({ ...before, message: "THREE\n\n" });
    expect(git(repo, ["rev-parse", "HEAD~1"]).trim()).toBe(parent);
    expect(git(repo, ["branch", "--show-current"]).trim()).toBe("main");
  });

  it("改更早的一条：它后面各条的内容、作者（含时区）、说明都不变", async () => {
    const { repo, one } = threeCommits();
    const before = ["HEAD~2", "HEAD~1", "HEAD"].map((ref) => show(repo, ref));
    expect(await rewordCommit.execute(cli, repo, one, "ONE")).toBe(RewordOutcome.Reworded);
    const after = ["HEAD~2", "HEAD~1", "HEAD"].map((ref) => show(repo, ref));
    expect(after).toEqual([{ ...before[0], message: "ONE\n\n" }, before[1], before[2]]);
    expect(git(repo, ["rev-parse", "HEAD~3"]).trim()).toBe(
      git(repo, ["rev-parse", `${one}~1`]).trim(),
    );
  });

  it("暂存区与工作区的改动原样留着", async () => {
    const { repo, one } = threeCommits();
    writeFileSync(join(repo, "f1"), "staged\n");
    git(repo, ["add", "f1"]);
    writeFileSync(join(repo, "f1"), "unstaged\n");
    writeFileSync(join(repo, "new.txt"), "untracked\n");
    const status = git(repo, ["status", "--porcelain"]);
    await rewordCommit.execute(cli, repo, one, "ONE");
    expect(git(repo, ["status", "--porcelain"])).toBe(status);
    expect(git(repo, ["show", ":f1"])).toBe("staged\n");
    expect(readFileSync(join(repo, "f1"), "utf8")).toBe("unstaged\n");
  });

  it("改根提交", async () => {
    const repo = makeTempRepo("reword-root");
    const root = git(repo, ["rev-parse", "HEAD"]).trim();
    expect(await rewordCommit.execute(cli, repo, root, "first")).toBe(RewordOutcome.Reworded);
    expect(git(repo, ["log", "--format=%s"]).trim()).toBe("first");
  });

  it("新说明按 commit -F 的默认规则整理：去行尾空白、合并空行、结尾一个换行", async () => {
    const { repo } = threeCommits();
    const head = git(repo, ["rev-parse", "HEAD"]).trim();
    await rewordCommit.execute(cli, repo, head, "subject  \n\n\n\nbody\n\n\n");
    expect(git(repo, ["cat-file", "commit", "HEAD"]).split("\n\n").slice(1).join("\n\n")).toBe(
      "subject\n\nbody\n",
    );
  });

  it("中间有合并提交：拒绝，什么都不动", async () => {
    const { repo, one } = threeCommits();
    git(repo, ["switch", "-qc", "side", one]);
    git(repo, ["commit", "-q", "--allow-empty", "-m", "side"]);
    git(repo, ["switch", "-q", "main"]);
    git(repo, ["merge", "-q", "--no-ff", "-m", "merge", "side"]);
    const head = git(repo, ["rev-parse", "HEAD"]).trim();
    expect(await rewordCommit.execute(cli, repo, one, "ONE")).toBe(RewordOutcome.NotLinear);
    expect(git(repo, ["rev-parse", "HEAD"]).trim()).toBe(head);
  });

  it("不在当前分支上（只在别的分支上）：拒绝", async () => {
    const { repo } = threeCommits();
    git(repo, ["switch", "-qc", "side", "HEAD~1"]);
    git(repo, ["commit", "-q", "--allow-empty", "-m", "side"]);
    const side = git(repo, ["rev-parse", "HEAD"]).trim();
    git(repo, ["switch", "-q", "main"]);
    expect(await rewordCommit.execute(cli, repo, side, "SIDE")).toBe(RewordOutcome.NotLinear);
  });
});
