import { describe, expect, it, vi } from "vitest";
import type { BitmapLayer, Project, Shot } from "../shared/types";
import { bitmapLayerPath } from "../shared/projectOps";
import { createBitmapLayerWriteQueue } from "./bitmapLayerWriteQueue";
import { useClipboardActionController } from "./clipboardActionController";
import type { ClipboardSelection } from "./clipboardSelection";
import type { DeleteTarget } from "./deleteTarget";

const layer = (
  shotId: string,
  id: string,
  order: number,
  overrides: Partial<BitmapLayer> = {}
): BitmapLayer => ({
  id,
  kind: "paint",
  name: id,
  visible: true,
  locked: false,
  opacity: 1,
  blendMode: "normal",
  order,
  bitmapPath: bitmapLayerPath(shotId, id),
  width: 100,
  height: 100,
  ...overrides
});

const shot = (id: string, order: number, layers: BitmapLayer[]): Shot =>
  ({
    id,
    imagePath: `/scene/${id}.tif`,
    previewPath: `/scene/${id}.png`,
    fileName: `${id}.tif`,
    order,
    activeLayerId: layers[0]?.id,
    layers
  }) as Shot;

const projectWithShots = (shots: Shot[]): Project =>
  ({
    id: "project",
    name: "Project",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    shots,
    dialogues: []
  }) as Project;

const setupController = ({
  clipboardSelection,
  deleteTarget = { type: "shot" },
  folderPath = "/scene",
  metadataPath = "/scene/.storyboard-workbench/project.json",
  project,
  selectedShotIds = []
}: {
  clipboardSelection?: ClipboardSelection;
  deleteTarget?: DeleteTarget;
  folderPath?: string | undefined;
  metadataPath?: string | undefined;
  project: Project;
  selectedShotIds?: string[];
}) => {
  const projectRef = { current: project };
  const clipboardSelectionRef = { current: clipboardSelection };
  const deleteTargetRef = { current: deleteTarget };
  const selectedShotIdsRef = { current: selectedShotIds };
  const statuses: string[] = [];
  const clipboardSelections: Array<ClipboardSelection | undefined> = [];
  const deleteTargets: DeleteTarget[] = [];
  const dirtyShotIds: string[][] = [];
  const selectedShotIdsByCall: Array<string | undefined> = [];
  const selectedBitmapLayerTargets: Array<{ shotId: string; layerIds: string[] } | undefined> = [];
  const queuedPasteAnimations: Array<{
    kind: "shot" | "layer";
    sourceId: string;
    pastedId: string;
  }> = [];
  const undoEntries: string[] = [];
  const projectUpdateOptions: Array<{
    markFileNamesUnsynced: boolean | undefined;
    recordUndo: boolean | undefined;
  }> = [];

  const api = {
    ensureLayerAssets: vi.fn(async (payload) => payload),
    copyShotAssets: vi.fn(async (payload) => ({
      ...payload,
      imagePath: "/scene/pasted-shot.tif",
      fileName: "pasted-shot.tif",
      previewPath: "/scene/pasted-shot.png"
    })),
    copyLayerPng: vi.fn(async (payload) => ({
      ...payload,
      targetFilePath: `/scene/${payload.targetBitmapPath}`
    }))
  };

  const controller = useClipboardActionController<string>({
    api,
    bitmapLayerWriteQueueRef: { current: createBitmapLayerWriteQueue() },
    clipboardSelectionRef,
    createHistoryEntry: vi.fn(async () => "undo-entry"),
    createId: () => "pasted",
    deleteTargetRef,
    folderPath,
    markShotsDirty: (shotIds) => dirtyShotIds.push(shotIds),
    metadataPath,
    projectRef,
    queuePasteAnimation: (kind, sourceId, pastedId) => {
      queuedPasteAnimations.push({ kind, sourceId, pastedId });
    },
    recordUndoEntry: (entry) => undoEntries.push(entry),
    selectSingleShot: (shotId) => selectedShotIdsByCall.push(shotId),
    selectedShotIdsRef,
    setClipboardSelection: (nextClipboardSelection) => {
      clipboardSelections.push(nextClipboardSelection);
    },
    setDeleteTarget: (target) => deleteTargets.push(target),
    setSelectedBitmapLayerIds: (target) => selectedBitmapLayerTargets.push(target),
    setStatus: (status) => statuses.push(status),
    updateProject: (projectUpdate, markFileNamesUnsynced, recordUndo) => {
      projectUpdateOptions.push({ markFileNamesUnsynced, recordUndo });
      projectRef.current =
        typeof projectUpdate === "function" ? projectUpdate(projectRef.current) : projectUpdate;
    }
  });

  return {
    api,
    clipboardSelectionRef,
    clipboardSelections,
    controller,
    deleteTargets,
    dirtyShotIds,
    projectRef,
    projectUpdateOptions,
    queuedPasteAnimations,
    selectedBitmapLayerTargets,
    selectedShotIdsByCall,
    statuses,
    undoEntries
  };
};

describe("useClipboardActionController", () => {
  it("copies the active storyboard selection into clipboard state", () => {
    const { clipboardSelectionRef, clipboardSelections, controller, statuses } = setupController({
      project: projectWithShots([
        shot("shot-a", 0, [layer("shot-a", "image", 0, { kind: "image", name: "Image" })]),
        shot("shot-b", 1, [layer("shot-b", "image", 0, { kind: "image", name: "Image" })])
      ]),
      selectedShotIds: ["shot-b"]
    });

    controller.handleCopySelection();

    expect(clipboardSelectionRef.current).toEqual({ type: "shot", shotId: "shot-b" });
    expect(clipboardSelections).toEqual([{ type: "shot", shotId: "shot-b" }]);
    expect(statuses).toEqual(["Storyboard copied"]);
  });

  it("reports an empty paste without mutating project state", async () => {
    const { controller, projectRef, statuses } = setupController({
      project: projectWithShots([
        shot("shot-a", 0, [layer("shot-a", "image", 0, { kind: "image", name: "Image" })])
      ])
    });

    await controller.handlePasteSelection();

    expect(projectRef.current.shots.map((item) => item.id)).toEqual(["shot-a"]);
    expect(statuses).toEqual(["Nothing to paste"]);
  });

  it("pastes a copied storyboard after the selected target storyboard", async () => {
    const sourceLayers = [
      layer("source", "image", 0, { kind: "image", name: "Image" }),
      layer("source", "paint-a", 1, { name: "Paint A" })
    ];
    const {
      api,
      controller,
      deleteTargets,
      dirtyShotIds,
      projectRef,
      projectUpdateOptions,
      queuedPasteAnimations,
      selectedBitmapLayerTargets,
      selectedShotIdsByCall,
      statuses
    } = setupController({
      clipboardSelection: { type: "shot", shotId: "source" },
      project: projectWithShots([
        shot("source", 0, sourceLayers),
        shot("target", 1, [layer("target", "image", 0, { kind: "image", name: "Image" })])
      ]),
      selectedShotIds: ["target"]
    });

    await controller.handlePasteSelection();

    expect(api.ensureLayerAssets).toHaveBeenCalledWith({
      project: expect.objectContaining({ id: "project" }),
      folderPath: "/scene",
      metadataPath: "/scene/.storyboard-workbench/project.json"
    });
    expect(api.copyShotAssets).toHaveBeenCalledWith({
      folderPath: "/scene",
      sourceImagePath: "/scene/source.tif",
      fileName: "source.tif",
      layerCopies: [
        {
          sourceBitmapPath: bitmapLayerPath("source", "image"),
          targetBitmapPath: bitmapLayerPath("pasted", "image")
        },
        {
          sourceBitmapPath: bitmapLayerPath("source", "paint-a"),
          targetBitmapPath: bitmapLayerPath("pasted", "paint-a")
        }
      ]
    });
    expect(projectRef.current.shots.map((item) => item.id)).toEqual(["source", "target", "pasted"]);
    expect(dirtyShotIds).toEqual([["pasted"]]);
    expect(selectedShotIdsByCall).toEqual(["pasted"]);
    expect(selectedBitmapLayerTargets).toEqual([undefined]);
    expect(deleteTargets).toEqual([{ type: "shot" }]);
    expect(queuedPasteAnimations).toEqual([
      { kind: "shot", sourceId: "source", pastedId: "pasted" }
    ]);
    expect(projectUpdateOptions).toEqual([
      { markFileNamesUnsynced: undefined, recordUndo: undefined }
    ]);
    expect(statuses).toEqual(["Storyboard pasted"]);
  });

  it("pastes a copied layer before the current target layer without marking file names unsynced", async () => {
    const {
      api,
      controller,
      deleteTargets,
      dirtyShotIds,
      projectRef,
      projectUpdateOptions,
      queuedPasteAnimations,
      selectedBitmapLayerTargets,
      selectedShotIdsByCall,
      statuses,
      undoEntries
    } = setupController({
      clipboardSelection: { type: "layer", shotId: "source", layerId: "paint-source" },
      deleteTarget: { type: "layer", shotId: "target", layerId: "paint-target" },
      project: projectWithShots([
        shot("source", 0, [
          layer("source", "image", 0, { kind: "image", name: "Image" }),
          layer("source", "paint-source", 1, { name: "Paint Source" })
        ]),
        shot("target", 1, [
          layer("target", "image", 0, { kind: "image", name: "Image" }),
          layer("target", "paint-target", 1, { name: "Paint Target" })
        ])
      ])
    });

    await controller.handlePasteSelection();

    expect(api.copyLayerPng).toHaveBeenCalledWith({
      folderPath: "/scene",
      sourceBitmapPath: bitmapLayerPath("source", "paint-source"),
      targetBitmapPath: bitmapLayerPath("target", "layer-pasted")
    });
    expect(projectRef.current.shots[1].layers?.map((item) => item.id)).toEqual([
      "image",
      "layer-pasted",
      "paint-target"
    ]);
    expect(dirtyShotIds).toEqual([["target"]]);
    expect(undoEntries).toEqual(["undo-entry"]);
    expect(selectedShotIdsByCall).toEqual(["target"]);
    expect(selectedBitmapLayerTargets).toEqual([
      { shotId: "target", layerIds: ["layer-pasted"] }
    ]);
    expect(deleteTargets).toEqual([
      { type: "layer", shotId: "target", layerId: "layer-pasted" }
    ]);
    expect(queuedPasteAnimations).toEqual([
      { kind: "layer", sourceId: "paint-source", pastedId: "layer-pasted" }
    ]);
    expect(projectUpdateOptions).toEqual([
      { markFileNamesUnsynced: false, recordUndo: false }
    ]);
    expect(statuses).toEqual(['Layer "Paint Source" pasted']);
  });
});
