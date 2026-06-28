import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { nextBoardViewMode, visibleBoardViewMode } from "./boardViewMode";

const toolRailSource = readFileSync(new URL("./ToolRail.tsx", import.meta.url), "utf8");

describe("ToolRail", () => {
  it("does not own the board view mode toggle", () => {
    expect(toolRailSource).not.toContain("board-view-tool");
    expect(toolRailSource).not.toContain("setBoardViewMode");
  });

  it("toggles between storyboard and Japanese storyboard modes", () => {
    expect(nextBoardViewMode("storyboard")).toBe("japaneseStoryboard");
    expect(nextBoardViewMode("japaneseStoryboard")).toBe("storyboard");
  });

  it("shows the shared animation view at max zoom from either board mode", () => {
    expect(visibleBoardViewMode({ boardViewMode: "storyboard", isAnimationMode: true })).toBe("animation");
    expect(visibleBoardViewMode({ boardViewMode: "japaneseStoryboard", isAnimationMode: true })).toBe("animation");
  });

  it("returns to the configured board mode after animation mode exits", () => {
    expect(visibleBoardViewMode({ boardViewMode: "japaneseStoryboard", isAnimationMode: false })).toBe(
      "japaneseStoryboard"
    );
  });
});
