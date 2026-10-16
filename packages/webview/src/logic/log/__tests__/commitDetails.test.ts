import type { Commit } from "@dummy-git/shared";
import { describe, expect, it } from "vitest";
import { formatDateTime } from "../../utils/time.js";
import { commitDetailsView, personText } from "../commitDetails.js";

const alice = { name: "Alice", email: "alice@x.com", at: 1_700_000_000 };

function commit(message: string, committer = alice): Commit {
  return { hash: "1a2b3c4d5e6f", parents: [], author: alice, committer, message };
}

describe("commitDetailsView", () => {
  it("第一段是标题，后面是正文（去掉首尾空行）；短 hash；作者一行", () => {
    const view = commitDetailsView(commit("fix login\n\nbody line 1\nbody line 2\n\n"));
    expect(view).toEqual({
      subject: "fix login",
      body: "body line 1\nbody line 2",
      hash: "1a2b3c4",
      author: `Alice <alice@x.com>  ${formatDateTime(alice.at)}`,
    });
  });

  it("只有一行：没有正文", () => {
    expect(commitDetailsView(commit("fix login\n")).body).toBe("");
  });

  it("第一段本身有好几行：不算标题，整段都在正文里（同 IDEA）", () => {
    const view = commitDetailsView(commit("line one\nline two\n\nmore"));
    expect(view.subject).toBe("");
    expect(view.body).toBe("line one\nline two\n\nmore");
  });

  it("提交者是别人：committed by 一行", () => {
    const bob = { name: "Bob", email: "bob@x.com", at: alice.at + 60 };
    expect(commitDetailsView(commit("x", bob)).committer).toBe(
      `committed by Bob <bob@x.com>  ${formatDateTime(bob.at)}`,
    );
  });

  it("同一个人、只是时间不同（rebase、amend 过）：committed 加时间", () => {
    const later = { ...alice, at: alice.at + 3600 };
    expect(commitDetailsView(commit("x", later)).committer).toBe(
      `committed ${formatDateTime(later.at)}`,
    );
  });

  it("作者与提交者完全一样：没有第二行", () => {
    expect(commitDetailsView(commit("x"))).not.toHaveProperty("committer");
  });
});

describe("personText", () => {
  it("邮箱为空时只写名字，不写空的 <>", () => {
    expect(personText({ name: "Alice", email: "", at: 0 })).toBe("Alice");
    expect(personText(alice)).toBe("Alice <alice@x.com>");
  });
});
