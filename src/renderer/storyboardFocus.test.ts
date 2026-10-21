import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { createProject } from "../shared/projectOps";
import { Topbar } from "./Topbar";
import { DndContext } from "@dnd-kit/core";
import { vi } from "vitest";
import { ParkingShelf } from "./ParkingShelf";
import { useRightSidebarController } from "./rightSidebarController";

it("offers ordinary Pending without an AI action in the real topbar", () => {
  const noop = () => undefined;
  const ref = { current: null };
  const props = {
    project: createProject("Focused storyboard"), blankShotPreset: "16:9", boardViewMode: "storyboard",
    folderInputValue: "", recentFolders: [], sceneMatteMode: undefined, workspaceTask: undefined,
    addShotMenuRef: ref, importHelpRef: ref, recentMenuRef: ref, matteMenuRef: ref, saveMenuRef: ref,
    ...Object.fromEntries(["hasSwbWarning", "isAddShotMenuOpen", "isAiPanelVisible", "isImportHelpOpen",
      "isImportLocked", "isImportNudging", "isMatteMenuOpen", "isParkingShelfOpen", "isRecentMenuOpen",
      "isSaveEmphasized", "isSaveMenuOpen", "isWorkspaceTaskRunning", "isDialogueOverlayDisabled",
      "isMatteConfigurationDisabled", "isSceneDialogueOverlayConfigured", "isSceneMatteConfigured", "needsSwbImport"]
      .map(key => [key, false])),
    ...Object.fromEntries(["setBlankShotPreset", "setBoardViewMode", "setFolderInputValue", "setIsAddShotMenuOpen",
      "setIsImportHelpOpen", "setIsMatteMenuOpen", "setIsRecentMenuOpen", "setIsSaveMenuOpen", "handleAddShot",
      "handleImportSwbFormat", "handleOpenFolderByPath", "handleDisableSceneMatte", "handlePlaceDialogueOnMatte",
      "handleSaveProject", "handleSetShotMatteMode", "handleToggleAiPanel", "handleTogglePendingShelf",
      "nudgeImportRequired", "updateProjectName", "updateProjectNaming"].map(key => [key, noop]))
  } as unknown as Parameters<typeof Topbar>[0];
  const html = renderToStaticMarkup(React.createElement(Topbar, props));
  expect(html).toContain('aria-label="Toggle pending sidebar"');
  expect(html).toContain("Add");
  expect(html).toContain("Save");
  expect(html).not.toContain("Toggle AI Draft panel");
});

it("renders ordinary parked storyboards without candidate controls in the actual Pending shelf", () => {
  vi.stubGlobal("window", { storyboard: { assetUrl: (path: string) => `fixture:${path}` } });
  try {
    const props = {
      isOpen: true,
      shots: [{ id: "parked", order: 0, fileName: "draft.tiff", imagePath: "/synthetic/Pending/draft.tiff" }],
      aiCandidates: [{ id: "old-candidate", shotId: "parked", filePath: "/synthetic/candidate.png", createdAt: "2026-01-01" }],
      aiCandidateSourceNames: {}, onDiscardAiCandidate: () => undefined
    } as unknown as Parameters<typeof ParkingShelf>[0];
    const html = renderToStaticMarkup(React.createElement(DndContext, null, React.createElement(ParkingShelf, props)));
    expect(html).toContain('data-parked-shot-id="parked"');
    expect(html).toContain("draft.tiff");
    expect(html).toContain("<strong>1</strong>");
    expect(html).not.toContain("AI Generated");
    expect(html).not.toContain("Discard AI candidate");
  } finally {
    vi.unstubAllGlobals();
  }
});

it("normal Pending controller no longer exposes an AI toggle", () => {
  let controls: ReturnType<typeof useRightSidebarController> | undefined;
  const Probe = () => {
    controls = useRightSidebarController({ isAnimationMode: false });
    return null;
  };
  renderToStaticMarkup(React.createElement(Probe));
  expect(controls).toHaveProperty("togglePendingShelf");
  expect(controls).toHaveProperty("openPendingShelf");
  expect(controls).not.toHaveProperty("toggleAiPanel");
  expect(controls).not.toHaveProperty("isAiPanelVisible");
});
