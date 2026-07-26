import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const topbarSource = readFileSync(new URL("./Topbar.tsx", import.meta.url), "utf8");

describe("Topbar", () => {
  it("offers the 1.85:1 blank shot preset at 1998 by 1080", () => {
    expect(topbarSource).toContain('{ id: "1.85:1", label: "1.85:1", detail: "1998 x 1080" }');
    expect(topbarSource).toContain("data-blank-shot-preset={preset.id}");
  });

  it("owns the storyboard board mode segmented control", () => {
    expect(topbarSource).toContain("board-view-toggle");
    expect(topbarSource).toContain('setBoardViewMode("storyboard")');
    expect(topbarSource).toContain('setBoardViewMode("japaneseStoryboard")');
    expect(topbarSource).toContain("StoryboardGridIcon");
    expect(topbarSource).toContain("JapaneseStoryboardIcon");
  });

  it("places matte and dialogue actions beside the board view control", () => {
    expect(topbarSource).toContain("shot-presentation-toggle");
    expect(topbarSource).toContain("MatteIcon");
    expect(topbarSource).toContain("DialogueOverlayIcon");
    expect(topbarSource).toContain('handleSetShotMatteMode("expanded")');
    expect(topbarSource).toContain('handleSetShotMatteMode("embedded")');
    expect(topbarSource).toContain("Every storyboard · +75px top / bottom");
    expect(topbarSource).toContain(
      "disabled={isDialogueOverlayDisabled || !isSceneMatteConfigured}"
    );
    expect(topbarSource).toContain(
      'className={isSceneDialogueOverlayConfigured ? "selected" : ""}'
    );
    expect(topbarSource).toContain("Turn off dialogue for every storyboard in this scene");
    expect(topbarSource).toContain("void handleDisableSceneMatte()");
    expect(topbarSource).toContain("if (sceneMatteMode)");
  });
});
