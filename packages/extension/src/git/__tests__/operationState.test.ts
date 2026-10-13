import { OperationKind } from "@dummy-git/shared";
import { describe, expect, it } from "vitest";
import { branchFromHead, interpretOperation, mergeEditorTitles } from "../operationState.js";

const HASH = "4997c87db13069c6e08ef695544c6dae74a76a9c";
const ONTO = "9b77743bcc605fe0cd0f43f7378cc7dcae91e1e0";

describe("interpretOperation", () => {
  it("什么都没有 → null", () => {
    expect(interpretOperation({})).toBeNull();
  });

  it("merge：从说明里取分支名，注释行不进说明", () => {
    expect(
      interpretOperation({
        mergeHead: `${HASH}\n`,
        mergeMessage: "Merge branch 'feature'\n\n# Conflicts:\n#\tf.txt\n",
      }),
    ).toEqual({
      kind: OperationKind.Merge,
      id: HASH,
      subject: "feature",
      incoming: "feature",
      message: "Merge branch 'feature'",
    });
  });

  it("merge 远程跟踪分支：名字带着远程", () => {
    expect(
      interpretOperation({
        mergeHead: HASH,
        mergeMessage: "Merge remote-tracking branch 'origin/feature'\n",
      })?.subject,
    ).toBe("origin/feature");
  });

  it("说明里没有分支名：用短 hash", () => {
    const operation = interpretOperation({ mergeHead: HASH, mergeMessage: "custom message\n" });
    expect(operation?.subject).toBe(HASH.slice(0, 7));
    expect(operation?.message).toBe("custom message");
  });

  it("rebase 目录在就不看 MERGE_HEAD", () => {
    expect(
      interpretOperation({
        mergeHead: HASH,
        rebaseMerge: {
          headName: "refs/heads/feature\n",
          onto: `${ONTO}\n`,
          message: "feature\n\n",
          stopped: `${HASH}\n`,
        },
      }),
    ).toEqual({
      kind: OperationKind.Rebase,
      id: HASH,
      subject: "feature",
      current: ONTO.slice(0, 7),
      incoming: HASH.slice(0, 7),
      message: "feature",
    });
  });

  it("rebase-apply 用 original-commit 与 final-commit", () => {
    const operation = interpretOperation({
      rebaseApply: {
        headName: "refs/heads/topic/a\n",
        onto: `${ONTO}\n`,
        message: "feature\n",
        stopped: `${HASH}\n`,
      },
    });
    expect(operation?.kind).toBe(OperationKind.Rebase);
    expect(operation?.subject).toBe("topic/a");
    expect(operation?.id).toBe(HASH);
    expect(operation?.message).toBe("feature");
  });

  it("cherry-pick 与 revert 用短 hash，说明去掉注释", () => {
    expect(
      interpretOperation({
        cherryPickHead: `${HASH}\n`,
        mergeMessage: "feature\n\n# Conflicts:\n#\tf.txt\n",
      }),
    ).toMatchObject({
      kind: OperationKind.CherryPick,
      id: HASH,
      subject: HASH.slice(0, 7),
      incoming: HASH.slice(0, 7),
      message: "feature",
    });
    expect(interpretOperation({ revertHead: HASH })?.kind).toBe(OperationKind.Revert);
  });
});

describe("branchFromHead", () => {
  it("符号引用取出分支名，游离的 hash 没有名字", () => {
    expect(branchFromHead("ref: refs/heads/main\n")).toBe("main");
    expect(branchFromHead("ref: refs/heads/topic/a\n")).toBe("topic/a");
    expect(branchFromHead(`${HASH}\n`)).toBeUndefined();
  });
});

describe("mergeEditorTitles", () => {
  it("没有操作：左当前分支，右 Stashed Changes", () => {
    expect(mergeEditorTitles(null, "main")).toEqual({
      current: "Current (main)",
      incoming: "Incoming (Stashed Changes)",
    });
  });

  it("merge：左当前分支，右对方分支", () => {
    const operation = interpretOperation({
      mergeHead: HASH,
      mergeMessage: "Merge branch 'feature'\n",
    });
    expect(mergeEditorTitles(operation, "main")).toEqual({
      current: "Current (main)",
      incoming: "Incoming (feature)",
    });
  });

  it("rebase：左是 onto 的短 hash，右是正在重放的提交", () => {
    const operation = interpretOperation({
      rebaseMerge: {
        headName: "refs/heads/feature\n",
        onto: `${ONTO}\n`,
        stopped: `${HASH}\n`,
        message: "feature\n",
      },
    });
    expect(mergeEditorTitles(operation, undefined)).toEqual({
      current: `Current (${ONTO.slice(0, 7)})`,
      incoming: `Incoming (${HASH.slice(0, 7)})`,
    });
  });
});
