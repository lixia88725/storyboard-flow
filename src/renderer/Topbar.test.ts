import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const topbarSource = readFileSync(new URL("./Topbar.tsx", import.meta.url), "utf8");

describe("Topbar", () => {
  it("owns the storyboard board mode segmented control", () => {
    expect(topbarSource).toContain("board-view-toggle");
    expect(topbarSource).toContain('setBoardViewMode("storyboard")');
    expect(topbarSource).toContain('setBoardViewMode("japaneseStoryboard")');
    expect(topbarSource).toContain("StoryboardGridIcon");
    expect(topbarSource).toContain("JapaneseStoryboardIcon");
  });
});
