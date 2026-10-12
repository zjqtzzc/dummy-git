import { describe, expect, it } from "vitest";
import { hasConflictMarkers } from "../conflictMarkers.js";

describe("hasConflictMarkers", () => {
  it("行首的三种标记都算", () => {
    expect(hasConflictMarkers("a\n<<<<<<< HEAD\nb\n")).toBe(true);
    expect(hasConflictMarkers("a\n=======\nb\n")).toBe(true);
    expect(hasConflictMarkers("a\n>>>>>>> stash\n")).toBe(true);
  });

  it("不在行首、或多于七个的不算", () => {
    expect(hasConflictMarkers("x <<<<<<< y\n")).toBe(false);
    expect(hasConflictMarkers("========\n")).toBe(false);
    expect(hasConflictMarkers("resolved\n")).toBe(false);
  });
});
