import { afterEach, describe, expect, it, vi } from "vitest";
import { GitFailureError } from "../../git/failure.js";
import { brief, briefGitCommand, briefResult, briefString } from "../brief.js";
import { type Log, Operations, tagged } from "../operation.js";

/** 记下每一行与它的级别。 */
function recorder(): { log: Log; lines: string[] } {
  const lines: string[] = [];
  const at = (level: string) => (line: string) => void lines.push(`${level} ${line}`);
  return {
    log: { error: at("error"), warn: at("warn"), info: at("info"), debug: at("debug") },
    lines,
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("Operations", () => {
  it("开头一行（来源、命令、参数，不含 repo），结尾一行（结果摘要）", async () => {
    const { log, lines } = recorder();
    await new Operations(log).run(
      "dummyGit.commit",
      "getStashes",
      { repo: "/r", hash: "abc" },
      async () => [1, 2],
    );
    expect(lines[0]).toBe('info #1 dummyGit.commit → getStashes {hash: "abc"}');
    expect(lines[1]).toMatch(/^info #1 ✓ \d+ms → 2 项$/);
  });

  it("编号跨 await 还在；并发的两个各是各的", async () => {
    const operations = new Operations(recorder().log);
    const seen: string[] = [];
    const task = async () => {
      const before = tagged("x");
      await tick();
      seen.push(before, tagged("x"));
      return null;
    };
    await Promise.all([operations.run("a", "x", {}, task), operations.run("b", "y", {}, task)]);
    expect(seen.sort()).toEqual(["#1 x", "#1 x", "#2 x", "#2 x"]);
    expect(tagged("x")).toBe("x");
  });

  it("git 拒绝记 warn，别的异常记 error；照样抛出", async () => {
    const { log, lines } = recorder();
    const operations = new Operations(log);
    const refused = new GitFailureError(["stash", "drop"], 1, "error: nope\nmore");
    await expect(operations.run("m", "dropStash", {}, () => Promise.reject(refused))).rejects.toBe(
      refused,
    );
    await expect(
      operations.run("m", "x", {}, () => Promise.reject(new Error("bug"))),
    ).rejects.toThrow("bug");
    expect(lines[1]).toMatch(/^warn #1 ✗ \d+ms git stash drop 失败（exit 1）：error: nope$/);
    expect(lines[3]).toMatch(/^error #2 ✗ \d+ms bug$/);
  });
});

describe("Operations.context：刷新时写当时的操作情况", () => {
  it("没有操作时为空；进行中的列出来；结束的写多久前", async () => {
    const operations = new Operations(recorder().log);
    expect(operations.context()).toBe("");
    let during = "";
    await operations.run("m", "stash", {}, async () => {
      during = operations.context();
      return null;
    });
    expect(during).toBe("进行中 #1");
    expect(operations.context()).toMatch(/^#1 在 \d+ms 前结束$/);
  });
});

describe("慢：超过 1 秒标 (slow)、记 warn", () => {
  afterEach(() => vi.restoreAllMocks());

  it("操作", async () => {
    const { log, lines } = recorder();
    vi.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValueOnce(1500);
    await new Operations(log).run("m", "push", {}, async () => null);
    expect(lines[1]).toBe("warn #1 ✓ 1500ms (slow)");
  });

  it("git 命令", () => {
    const record = { args: ["fetch", "--all"], outcome: "exit 0", stderr: "" };
    expect(briefGitCommand({ ...record, ms: 1500 })).toEqual({
      line: "> git fetch --all [1500ms] exit 0 (slow)",
      slow: true,
    });
    expect(briefGitCommand({ ...record, ms: 1000 }).slow).toBe(false);
  });
});

describe("briefGitCommand", () => {
  it("参数列前 12 个，--format= 折叠，带空格的加引号", () => {
    const paths = Array.from({ length: 20 }, (_, i) => `f${i}`);
    const { line } = briefGitCommand({
      args: ["log", "--format=%H%x00", "-m", "a b", ...paths],
      ms: 3,
      outcome: "exit 0",
      stderr: "",
    });
    expect(line).toBe(
      '> git log --format=... -m "a b" f0 f1 f2 f3 f4 f5 f6 f7 …（共 24 个参数） [3ms] exit 0',
    );
  });

  it("stderr 另起几行缩进写上，最多 5 行", () => {
    const stderr = Array.from({ length: 7 }, (_, i) => `hint: ${i}`).join("\n");
    const { line } = briefGitCommand({
      args: ["push"],
      ms: 3,
      outcome: "exit 1",
      stderr: `${stderr}\n`,
    });
    expect(line.split("\n")).toEqual([
      "> git push [3ms] exit 1",
      "    hint: 0",
      "    hint: 1",
      "    hint: 2",
      "    hint: 3",
      "    hint: 4",
      "    …（共 7 行）",
    ]);
  });
});

describe("brief", () => {
  it("多行只留第一行，长行截断，都注明原长", () => {
    expect(briefString("fix login\n\nbody")).toBe("fix login …（共 3 行）");
    expect(briefString("x".repeat(130))).toBe(`${"x".repeat(120)} …（共 130 字）`);
    expect(briefString("Dropped stash@{0} (c560c8f)\n")).toBe("Dropped stash@{0} (c560c8f)");
  });

  it("列表列前 3 项；对象展开一层，里面的列表也列前几项，再里面只写个数", () => {
    const paths = ["a", "b", "c", "d"];
    expect(brief({ paths, nested: { deep: 1 }, matrix: [[1, 2]] })).toBe(
      '{paths: ["a", "b", "c" …（共 4 项）], nested: {…}, matrix: [[2 项]]}',
    );
  });

  it("元素是对象的列表只写条数", () => {
    expect(brief({ head: "d518f61", changes: [{ path: "a" }, { path: "b" }] })).toBe(
      '{head: "d518f61", changes: [2 项]}',
    );
  });

  it("单个标识不缩短：完整 hash 原样", () => {
    const hash = "c560c8f80bccb38b3534cfc1e8c2e44cbe7b6651";
    expect(brief({ hash })).toBe(`{hash: "${hash}"}`);
  });

  it("结果：列表只记条数，null 不记", () => {
    expect(briefResult([{}, {}, {}])).toBe("3 项");
    expect(briefResult(null)).toBe("");
    expect(briefResult("Saved working directory")).toBe('"Saved working directory"');
  });
});
