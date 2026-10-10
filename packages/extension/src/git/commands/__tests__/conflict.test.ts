import { IndexStage } from "@dummy-git/shared";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupTempRepos, cli, stashConflict } from "../../../__tests__/support.js";
import { getConflictStages, getStageContent } from "../content.js";

afterEach(cleanupTempRepos);

describe("冲突时暂存区的几栏", () => {
  it("getConflictStages：两边都改的三栏都有，两边都新增的没有基准，没冲突的一栏都没有", async () => {
    const repo = stashConflict("stages");
    expect(await getConflictStages.execute(cli, repo, "both.txt")).toEqual([
      IndexStage.Base,
      IndexStage.Ours,
      IndexStage.Theirs,
    ]);
    expect(await getConflictStages.execute(cli, repo, "added.txt")).toEqual([
      IndexStage.Ours,
      IndexStage.Theirs,
    ]);
    expect(await getConflictStages.execute(cli, repo, "clean.txt")).toEqual([]);
  });

  it("getStageContent：基准、我们这边（已提交的）、对方（stash 里的）", async () => {
    const repo = stashConflict("stage-content");
    const read = async (stage: IndexStage) =>
      (await getStageContent.execute(cli, repo, stage, "both.txt")).toString();
    expect(await read(IndexStage.Base)).toBe("base\n");
    expect(await read(IndexStage.Ours)).toBe("committed\n");
    expect(await read(IndexStage.Theirs)).toBe("stashed\n");
  });
});
