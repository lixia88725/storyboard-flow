import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

describe("App view mode rendering", () => {
  it("uses the visible board view mode so animation can override Japanese storyboard mode", () => {
    expect(appSource).toContain("visibleBoardViewMode");
    expect(appSource).toContain("const currentBoardViewMode = visibleBoardViewMode");
    expect(appSource).toContain('currentBoardViewMode !== "japaneseStoryboard"');
  });

  it("shows the timeline whenever animation mode is active", () => {
    expect(appSource).toContain("{isAnimationMode && orderedShots.length > 0 ? (");
    expect(appSource).not.toContain("isStoryboardBoardMode && isAnimationMode && orderedShots.length > 0");
  });
});
