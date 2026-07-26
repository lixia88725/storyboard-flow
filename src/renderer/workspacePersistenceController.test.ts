import { describe, expect, it, vi } from "vitest";
import {
  hasOnlyCompatibleExternalEdits,
  runExclusiveWorkspaceAction,
  shouldEmphasizeSaveButton,
  hasUnsavedWorkspaceChanges,
  projectChangedDuringLoad,
  shouldAutosaveAfterLoad,
  shouldPersistLoadedProject,
  shouldRunAutosave
} from "./workspacePersistenceController";
import type { Project, Shot } from "../shared/types";

const projectWithShotStatuses = (statuses: Array<NonNullable<Shot["swb"]>["status"]>): Project => ({
  id: "project-1",
  name: "Storyboard",
  shots: statuses.map((status, index) => ({
    id: `shot-${index}`,
    imagePath: `/scene/${index}.tiff`,
    fileName: `${index}.tiff`,
    order: index,
    dialogues: [],
    layers: [],
    swb: status
      ? {
          version: 1,
          status,
          canvasWidth: 1920,
          canvasHeight: 1080
        }
      : undefined
  })),
  dialogues: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
});

describe("workspacePersistenceController", () => {
  it("reuses an in-flight workspace action and allows a new action after it settles", async () => {
    let resolveFirst: ((value: boolean) => void) | undefined;
    const action = vi
      .fn<() => Promise<boolean>>()
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            resolveFirst = resolve;
          })
      )
      .mockResolvedValueOnce(false);
    const inFlightRef = { current: undefined as Promise<boolean> | undefined };

    const first = runExclusiveWorkspaceAction(inFlightRef, action);
    const overlapping = runExclusiveWorkspaceAction(inFlightRef, action);
    await Promise.resolve();

    expect(overlapping).toBe(first);
    expect(action).toHaveBeenCalledTimes(1);

    resolveFirst?.(true);
    await expect(first).resolves.toBe(true);
    expect(inFlightRef.current).toBeUndefined();

    await expect(runExclusiveWorkspaceAction(inFlightRef, action)).resolves.toBe(false);
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("runs autosave only when the workspace has an API and active paths after the initial revision", () => {
    expect(
      shouldRunAutosave(0, "/scene", "/scene/.storyboard-workbench/storyboard.project.json", true)
    ).toBe(false);
    expect(
      shouldRunAutosave(1, "", "/scene/.storyboard-workbench/storyboard.project.json", true)
    ).toBe(false);
    expect(
      shouldRunAutosave(1, "/scene", "/scene/.storyboard-workbench/storyboard.project.json", true)
    ).toBe(true);
  });

  it("reports unsaved changes when dirty shots, save state, or filename sync are pending", () => {
    expect(
      hasUnsavedWorkspaceChanges(0, "saved", "synced")
    ).toBe(false);
    expect(
      hasUnsavedWorkspaceChanges(1, "saved", "synced")
    ).toBe(true);
    expect(
      hasUnsavedWorkspaceChanges(0, "saving", "synced")
    ).toBe(true);
    expect(
      hasUnsavedWorkspaceChanges(0, "saved", "unsynced")
    ).toBe(true);
  });

  it("emphasizes the Save button only when workspace output is not synced", () => {
    expect(shouldEmphasizeSaveButton(0, "saved", "synced")).toBe(false);
    expect(shouldEmphasizeSaveButton(1, "saved", "synced")).toBe(true);
    expect(shouldEmphasizeSaveButton(0, "saving", "synced")).toBe(true);
    expect(shouldEmphasizeSaveButton(0, "saved", "unsynced")).toBe(true);
  });

  it("persists loaded projects only for metadata-only project changes without import or dirty output", () => {
    expect(
      shouldPersistLoadedProject(true, true, false, false, false)
    ).toBe(true);
    expect(
      shouldPersistLoadedProject(false, true, false, false, false)
    ).toBe(false);
    expect(
      shouldPersistLoadedProject(true, true, false, false, true)
    ).toBe(false);
  });

  it("autosaves after load when output changed and no script import is pending", () => {
    expect(
      shouldAutosaveAfterLoad(false, false, false, false)
    ).toBe(false);
    expect(
      shouldAutosaveAfterLoad(true, false, false, false)
    ).toBe(true);
    expect(
      shouldAutosaveAfterLoad(true, false, false, true)
    ).toBe(false);
  });

  it("auto-imports only compatible external edits and rejects non-swb or incompatible edits", () => {
    expect(hasOnlyCompatibleExternalEdits(projectWithShotStatuses(["compatible-external-edit"]))).toBe(true);
    expect(hasOnlyCompatibleExternalEdits(projectWithShotStatuses(["owned"]))).toBe(false);
    expect(
      hasOnlyCompatibleExternalEdits(
        projectWithShotStatuses(["compatible-external-edit", "incompatible-external-edit"])
      )
    ).toBe(false);
    expect(
      hasOnlyCompatibleExternalEdits(projectWithShotStatuses(["compatible-external-edit", "non-swb"]))
    ).toBe(false);
  });

  it("detects project changes from load when shot output metadata changes", () => {
    const before = projectWithShotStatuses(["owned"]);
    expect(projectChangedDuringLoad(before, before)).toBe(false);
    expect(
      projectChangedDuringLoad(before, {
        ...before,
        shots: [{ ...before.shots[0], previewPath: "/scene/preview.png" }]
      })
    ).toBe(true);
    expect(
      projectChangedDuringLoad(before, {
        ...before,
        shots: [{ ...before.shots[0], fileName: "renamed.tiff" }]
      })
    ).toBe(true);
    expect(
      projectChangedDuringLoad(before, {
        ...before,
        shots: [{ ...before.shots[0], activeLayerId: "layer-1" }]
      })
    ).toBe(true);
    expect(
      projectChangedDuringLoad(before, {
        ...before,
        shots: [{
          ...before.shots[0],
          layers: [{
            id: "layer-1",
            name: "Layer",
            kind: "paint",
            visible: true,
            locked: false,
            opacity: 1,
            blendMode: "normal",
            order: 1,
            bitmapPath: "layer-1.png",
            width: 1920,
            height: 1080
          }]
        }]
      })
    ).toBe(true);
  });
});
