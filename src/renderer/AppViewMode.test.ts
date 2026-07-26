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
    expect(appSource).toContain("const inheritedMatteMode = sceneMatteModeForProject(project)");
    expect(appSource).toContain(
      "const inheritedDialogueOverlayEnabled ="
    );
    expect(appSource).toContain(
      "dialogueOverlayEnabled: inheritedDialogueOverlayEnabled"
    );
    expect(appSource).toContain("const importedProject = await loadFolderScan(");
    expect(appSource).toContain("sceneMatteInheritanceRef.current?.(");
  });

  it("serializes autosave and Save with bitmap presentation transactions", () => {
    expect(appSource).toContain(
      "bitmapLayerWriteQueueRef.current.runExclusive(async () => {"
    );
    expect(appSource).toContain(
      "await persistWorkspaceWithoutAssetLock(projectToSave);"
    );
    expect(appSource).toContain("projectRef.current = result.project;");
    expect(appSource).toContain(
      "if (workspaceRecoveryRequiredRef.current) {"
    );
  });
});
