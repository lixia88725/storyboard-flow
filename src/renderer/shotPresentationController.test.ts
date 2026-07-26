import { describe, expect, it, vi } from "vitest";
import type { Project } from "../shared/types";
import { createBitmapLayerWriteQueue } from "./bitmapLayerWriteQueue";
import type { ProjectHistoryEntry } from "./projectHistoryController";
import { createShotPresentationController } from "./shotPresentationController";

const project = (): Project => ({
  id: "project-1",
  name: "Storyboard",
  shots: [
    {
      id: "shot-1",
      imagePath: "/scene/001.tiff",
      fileName: "001.tiff",
      order: 0,
      activeLayerId: "paint-1",
      layers: [
        {
          id: "layer-image",
          kind: "image",
          name: "Image",
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: "normal",
          order: 0,
          bitmapPath: ".storyboard-workbench/layers/shot-1/layer-image.png",
          width: 1920,
          height: 1080
        },
        {
          id: "paint-1",
          kind: "paint",
          name: "Drawing",
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: "normal",
          order: 1,
          bitmapPath: ".storyboard-workbench/layers/shot-1/paint-1.png",
          width: 1920,
          height: 1080
        }
      ],
      swb: {
        version: 1,
        status: "owned",
        canvasWidth: 1920,
        canvasHeight: 1080
      }
    },
    {
      id: "shot-2",
      imagePath: "/scene/002.tiff",
      fileName: "002.tiff",
      order: 1,
      activeLayerId: "paint-2",
      layers: [
        {
          id: "layer-image",
          kind: "image",
          name: "Image",
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: "normal",
          order: 0,
          bitmapPath: ".storyboard-workbench/layers/shot-2/layer-image.png",
          width: 1920,
          height: 1080
        },
        {
          id: "paint-2",
          kind: "paint",
          name: "Drawing",
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: "normal",
          order: 1,
          bitmapPath: ".storyboard-workbench/layers/shot-2/paint-2.png",
          width: 1920,
          height: 1080
        }
      ],
      swb: {
        version: 1,
        status: "owned",
        canvasWidth: 1920,
        canvasHeight: 1080
      }
    }
  ],
  dialogues: [
    { id: "dialogue-1", shotId: "shot-1", text: "First line", order: 0 },
    { id: "dialogue-2", shotId: "shot-1", text: "Second line", order: 1 }
  ],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
});

const harness = () => {
  const projectRef = { current: project() };
  const api = {
    ensureLayerAssets: vi.fn(async (payload) => payload),
    writeLayerPng: vi.fn(async (payload) => ({ ...payload, filePath: "/layer.png" })),
    readLayerPng: vi.fn(),
    deleteLayerPng: vi.fn(async (payload) => payload)
  } as unknown as Window["storyboard"];
  const createHistoryEntry = vi.fn(async (bitmapPaths: string[] = []) => ({
    project: projectRef.current,
    selectedShotIds: ["shot-1"],
    fileNameSyncState: "synced" as const,
    layerAssets: bitmapPaths.map((bitmapPath) => ({
      bitmapPath,
      dataUrl: `data:image/png;base64,${bitmapPath.includes("image") ? "image" : "paint"}`
    }))
  }));
  const recordUndoEntry = vi.fn();
  const markShotsDirty = vi.fn();
  let recoveryRequiredMessage: string | undefined;
  const onRecoveryRequired = vi.fn((message: string) => {
    recoveryRequiredMessage = message;
  });
  const setStatus = vi.fn();
  const createDialogueOverlay = vi.fn(() => "data:image/png;base64,dialogue");
  const updateProject = vi.fn((update: Project | ((current: Project) => Project)) => {
    projectRef.current =
      typeof update === "function" ? update(projectRef.current) : update;
  });
  const controller = createShotPresentationController({
    api,
    bitmapLayerWriteQueueRef: { current: createBitmapLayerWriteQueue() },
    collapseBitmapLayer: vi.fn(async (_source, layer) => `data:image/png;base64,collapsed-${layer.id}`),
    createDialogueOverlay,
    createMatteOverlay: vi.fn(() => "data:image/png;base64,matte"),
    createHistoryEntry: createHistoryEntry as (
      bitmapPaths?: string[]
    ) => Promise<ProjectHistoryEntry>,
    expandBitmapLayer: vi.fn(async (_source, layer) => `data:image/png;base64,${layer.id}`),
    folderPath: "/scene",
    getRecoveryRequiredMessage: () => recoveryRequiredMessage,
    markShotsDirty,
    metadataPath: "/scene/.storyboard-workbench/storyboard.project.json",
    onRecoveryRequired,
    projectRef,
    recordUndoEntry,
    setStatus,
    shotPresentationActionRef: { current: undefined },
    updateProject
  });

  return {
    api,
    controller,
    createDialogueOverlay,
    createHistoryEntry,
    markShotsDirty,
    onRecoveryRequired,
    projectRef,
    recordUndoEntry,
    setStatus,
    updateProject
  };
};

describe("shotPresentationController", () => {
  it("expands every storyboard and writes a locked matte overlay for the whole scene", async () => {
    const result = harness();

    await result.controller.handleSetShotMatteMode("expanded");

    expect(result.api.ensureLayerAssets).toHaveBeenCalledOnce();
    expect(result.api.writeLayerPng).toHaveBeenCalledTimes(6);
    expect(result.projectRef.current.shots.map((shot) => shot.swb?.canvasHeight)).toEqual([
      1230,
      1230
    ]);
    expect(
      result.projectRef.current.shots.map((shot) =>
        shot.layers?.map((layer) => layer.height)
      )
    ).toEqual([
      [1230, 1230, 1230],
      [1230, 1230, 1230]
    ]);
    expect(
      result.projectRef.current.shots.map((shot) => shot.layers?.at(-1))
    ).toEqual([
      expect.objectContaining({ id: "layer-matte-overlay", locked: true }),
      expect.objectContaining({ id: "layer-matte-overlay", locked: true })
    ]);
    expect(
      result.projectRef.current.shots.map((shot) => shot.presentation?.matte?.mode)
    ).toEqual(["expanded", "expanded"]);
    expect(result.recordUndoEntry).toHaveBeenCalledOnce();
    expect(result.markShotsDirty).toHaveBeenCalledWith(["shot-1", "shot-2"]);
  });

  it("marks existing mattes scene-wide and writes only the transparent overlay assets", async () => {
    const result = harness();

    await result.controller.handleSetShotMatteMode("embedded");

    expect(result.api.ensureLayerAssets).not.toHaveBeenCalled();
    expect(result.api.writeLayerPng).toHaveBeenCalledTimes(2);
    expect(result.projectRef.current.shots.map((shot) => shot.swb?.canvasHeight)).toEqual([
      1080,
      1080
    ]);
    expect(
      result.projectRef.current.shots.map((shot) => shot.presentation?.matte)
    ).toEqual([
      { mode: "embedded", top: 75, bottom: 75 },
      { mode: "embedded", top: 75, bottom: 75 }
    ]);
  });

  it("toggles ordered dialogue overlays for every storyboard in the scene", async () => {
    const result = harness();
    await result.controller.handleSetShotMatteMode("embedded");

    await result.controller.handlePlaceDialogueOnMatte();

    const sceneLayers = result.projectRef.current.shots.map((shot) => shot.layers ?? []);
    expect(sceneLayers.map((layers) => layers.at(-1))).toEqual([
      expect.objectContaining({
        id: "layer-dialogue-overlay",
        locked: true,
        width: 1920,
        height: 1080
      }),
      expect.objectContaining({
        id: "layer-dialogue-overlay",
        locked: true,
        width: 1920,
        height: 1080
      })
    ]);
    expect(result.createDialogueOverlay).toHaveBeenNthCalledWith(
      1,
      1920,
      1080,
      75,
      "First line / Second line"
    );
    expect(result.createDialogueOverlay).toHaveBeenNthCalledWith(
      2,
      1920,
      1080,
      75,
      ""
    );
    expect(result.api.writeLayerPng).toHaveBeenLastCalledWith({
      folderPath: "/scene",
      bitmapPath: ".storyboard-workbench/layers/shot-2/layer-dialogue-overlay.png",
      dataUrl: "data:image/png;base64,dialogue"
    });
    expect(result.setStatus).toHaveBeenLastCalledWith(
      "Placed dialogue overlays on 2 storyboards"
    );
    expect(sceneLayers.every((layers) => layers.at(-2)?.id === "layer-matte-overlay")).toBe(true);

    result.recordUndoEntry.mockClear();
    await result.controller.handlePlaceDialogueOnMatte();

    expect(
      result.projectRef.current.shots.every((shot) =>
        shot.layers?.every((layer) => layer.id !== "layer-dialogue-overlay")
      )
    ).toBe(true);
    expect(result.api.deleteLayerPng).toHaveBeenCalledTimes(2);
    expect(result.recordUndoEntry).toHaveBeenCalledOnce();
    expect(result.setStatus).toHaveBeenLastCalledWith(
      "Turned off dialogue overlays for 2 storyboards"
    );
  });

  it("rolls back the whole scene when writing a dialogue overlay fails", async () => {
    const result = harness();
    await result.controller.handleSetShotMatteMode("embedded");
    vi.mocked(result.api.writeLayerPng).mockClear();
    vi.mocked(result.api.writeLayerPng)
      .mockResolvedValueOnce({
        folderPath: "/scene",
        bitmapPath: ".storyboard-workbench/layers/shot-1/layer-dialogue-overlay.png",
        dataUrl: "data:image/png;base64,dialogue",
        filePath: "/layer.png"
      })
      .mockRejectedValueOnce(new Error("dialogue write failed"));
    result.recordUndoEntry.mockClear();

    await result.controller.handlePlaceDialogueOnMatte();

    expect(result.recordUndoEntry).not.toHaveBeenCalled();
    expect(
      result.projectRef.current.shots.every((shot) =>
        shot.layers?.every((layer) => layer.id !== "layer-dialogue-overlay")
      )
    ).toBe(true);
    expect(result.setStatus).toHaveBeenLastCalledWith(
      "Toggle scene dialogue failed: dialogue write failed"
    );
  });

  it("turns off expanded matte scene-wide, crops content, and removes system assets", async () => {
    const result = harness();
    await result.controller.handleSetShotMatteMode("expanded");
    await result.controller.handlePlaceDialogueOnMatte();
    vi.mocked(result.api.writeLayerPng).mockClear();
    vi.mocked(result.api.deleteLayerPng).mockClear();
    result.recordUndoEntry.mockClear();

    await result.controller.handleDisableSceneMatte();

    expect(result.api.writeLayerPng).toHaveBeenCalledTimes(4);
    expect(result.api.deleteLayerPng).toHaveBeenCalledTimes(4);
    expect(result.recordUndoEntry).toHaveBeenCalledOnce();
    expect(result.projectRef.current.shots.map((shot) => shot.swb?.canvasHeight)).toEqual([
      1080,
      1080
    ]);
    expect(
      result.projectRef.current.shots.map((shot) => shot.presentation?.matte)
    ).toEqual([undefined, undefined]);
    expect(
      result.projectRef.current.shots.map((shot) =>
        shot.layers?.some(
          (layer) =>
            layer.id === "layer-matte-overlay" ||
            layer.id === "layer-dialogue-overlay"
        )
      )
    ).toEqual([false, false]);
  });

  it("rolls back bitmap assets and project state when disabling a matte fails", async () => {
    const result = harness();
    await result.controller.handleSetShotMatteMode("expanded");
    vi.mocked(result.api.deleteLayerPng).mockRejectedValueOnce(new Error("delete failed"));
    result.recordUndoEntry.mockClear();

    await result.controller.handleDisableSceneMatte();

    expect(result.recordUndoEntry).not.toHaveBeenCalled();
    expect(result.projectRef.current.shots.every((shot) => Boolean(shot.presentation?.matte))).toBe(
      true
    );
    expect(result.setStatus).toHaveBeenLastCalledWith(
      "Turn off scene matte failed: delete failed"
    );
  });

  it("reports recovery-required state when asset rollback also fails", async () => {
    const result = harness();
    await result.controller.handleSetShotMatteMode("expanded");
    vi.mocked(result.api.writeLayerPng).mockRejectedValue(new Error("disk full"));

    await result.controller.handleDisableSceneMatte();

    expect(result.onRecoveryRequired).toHaveBeenCalledOnce();
    expect(result.onRecoveryRequired).toHaveBeenCalledWith(
      expect.stringContaining("Asset rollback also failed: disk full")
    );
    expect(result.recordUndoEntry).toHaveBeenCalledTimes(1);
    expect(result.projectRef.current.shots.every((shot) => Boolean(shot.presentation?.matte))).toBe(
      true
    );

    const writeCountAfterFailure = vi.mocked(result.api.writeLayerPng).mock.calls.length;
    await result.controller.handlePlaceDialogueOnMatte();
    expect(result.api.writeLayerPng).toHaveBeenCalledTimes(writeCountAfterFailure);
    expect(result.setStatus).toHaveBeenLastCalledWith(
      expect.stringContaining("Asset rollback also failed: disk full")
    );
  });

  it("does not overwrite a project edit made while a scene transaction is running", async () => {
    const result = harness();
    vi.mocked(result.api.writeLayerPng).mockImplementation(async (payload) => {
      result.projectRef.current = {
        ...result.projectRef.current,
        name: "Edited while matte was rendering"
      };
      return { ...payload, filePath: "/layer.png" };
    });
    result.recordUndoEntry.mockClear();

    await result.controller.handleSetShotMatteMode("embedded");

    expect(result.projectRef.current.name).toBe("Edited while matte was rendering");
    expect(result.projectRef.current.shots.every((shot) => !shot.presentation?.matte)).toBe(true);
    expect(result.recordUndoEntry).not.toHaveBeenCalled();
    expect(result.setStatus).toHaveBeenLastCalledWith(
      "Configure scene matte failed: The storyboard changed while this scene transaction was running"
    );
  });

  it("refuses to inherit presentation from a stale project snapshot", async () => {
    const result = harness();
    const expectedProject = result.projectRef.current;
    const inheritedProject = {
      ...expectedProject,
      name: "Project with a newly active shot"
    };
    result.projectRef.current = {
      ...expectedProject,
      name: "A newer storyboard edit"
    };

    const inherited = await result.controller.handleInheritSceneMatte(
      inheritedProject,
      "embedded",
      ["shot-1"],
      { expectedProject }
    );

    expect(inherited).toBe(false);
    expect(result.projectRef.current.name).toBe("A newer storyboard edit");
    expect(result.api.writeLayerPng).not.toHaveBeenCalled();
    expect(result.setStatus).toHaveBeenLastCalledWith(
      "The storyboard changed before scene presentation could be inherited; try again"
    );
  });

  it("inherits the scene matte for a newly active owned storyboard without adding undo history", async () => {
    const result = harness();
    await result.controller.handleSetShotMatteMode("embedded");
    const inheritedProject: Project = {
      ...result.projectRef.current,
      shots: [
        ...result.projectRef.current.shots,
        {
          ...project().shots[0],
          id: "shot-3",
          imagePath: "/scene/003.tiff",
          fileName: "003.tiff",
          order: 2,
          layers: project().shots[0].layers?.map((layer) => ({
            ...layer,
            id: layer.id === "paint-1" ? "paint-3" : layer.id,
            bitmapPath: layer.bitmapPath
              .replace("shot-1", "shot-3")
              .replace("paint-1", "paint-3")
          })),
          presentation: undefined
        }
      ]
    };
    result.recordUndoEntry.mockClear();

    await result.controller.handleInheritSceneMatte(
      inheritedProject,
      "embedded",
      ["shot-3"],
      { dialogueOverlayEnabled: true }
    );

    const inheritedShot = result.projectRef.current.shots.find((shot) => shot.id === "shot-3");
    expect(inheritedShot?.presentation?.matte?.mode).toBe("embedded");
    expect(
      inheritedShot?.layers?.some((layer) => layer.id === "layer-dialogue-overlay")
    ).toBe(true);
    expect(result.recordUndoEntry).not.toHaveBeenCalled();
  });

  it("removes a restored storyboard matte when the active scene is off", async () => {
    const result = harness();
    await result.controller.handleSetShotMatteMode("embedded");
    const restoredProject = result.projectRef.current;
    result.recordUndoEntry.mockClear();

    await result.controller.handleInheritSceneMatte(
      restoredProject,
      undefined,
      ["shot-1"]
    );

    expect(result.projectRef.current.shots[0].presentation?.matte).toBeUndefined();
    expect(result.projectRef.current.shots[1].presentation?.matte?.mode).toBe("embedded");
    expect(result.recordUndoEntry).not.toHaveBeenCalled();
  });
});
