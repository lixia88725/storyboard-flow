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

  it("renders the pending shelf in both storyboard and Japanese storyboard branches", () => {
    expect(appSource).toContain("const parkingShelfElement = (");
    expect(appSource.match(/{parkingShelfElement}/g)).toHaveLength(2);
  });

  it("routes captured pointers through shared board navigation in both board views", () => {
    expect(
      appSource.match(
        /onPointerDownCapture=\{handleBoardNavigationPointerDownCapture\}/g
      )
    ).toHaveLength(2);
  });

  it("applies the active scene matte after imported shots become owned", () => {
    expect(appSource).toContain("const mode = sceneMatteModeForProject(scene)");
    expect(appSource).toContain("dialogueOverlayEnabled: sceneDialogueOverlayEnabledForProject(scene)");
    // The normal operation prepares inherited assets before its accepted
    // publication, rather than using the retired post-load legacy callback.
    expect(appSource).toContain("prepare: prepareNormalSaveImportMatte");
    expect(appSource).toContain("published: normalSaveImageImportPublished");
  });

  it("serializes autosave and Save with bitmap presentation transactions", () => {
    // Canonical owner/adapter tests prove settlement and ACK, not these
    // source anchors; this check only protects their App composition.
    expect(appSource).toContain("queue: bitmapLayerWriteQueueRef.current");
    expect(appSource).toContain("normalSaveAppAdapterRef.current!.autosave(projectToSave)");
    expect(appSource).toContain("await normalSaveAppAdapterRef.current!.save()");
    expect(appSource).toContain(
      "if (workspaceRecoveryRequiredRef.current) {"
    );
  });
});
