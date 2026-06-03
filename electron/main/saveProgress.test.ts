import { describe, expect, it } from "vitest";
import { countSaveProgressShots, saveProgressShotIds } from "./saveProgress.js";

const projectWithShotCount = (count: number) => ({
  shots: Array.from({ length: count }, (_item, index) => ({ id: `shot-${index + 1}` }))
});

describe("save progress helpers", () => {
  it("falls back to all project shots when no dirty-shot list is provided", () => {
    expect(countSaveProgressShots(projectWithShotCount(20), saveProgressShotIds(undefined, []))).toBe(20);
  });

  it("counts only dirty and imported shots that still exist in the project", () => {
    const shotIds = saveProgressShotIds(
      ["shot-2", "shot-7", "shot-7", "deleted-shot"],
      ["shot-11", "shot-2"]
    );

    expect(countSaveProgressShots(projectWithShotCount(20), shotIds)).toBe(3);
  });

  it("reports zero changed shots when an explicit empty dirty list has no imports", () => {
    expect(countSaveProgressShots(projectWithShotCount(20), saveProgressShotIds([], []))).toBe(0);
  });
});
