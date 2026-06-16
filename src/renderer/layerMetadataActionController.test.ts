import { describe, expect, it } from "vitest";
import type { BitmapLayer, Project } from "../shared/types";
import { useLayerMetadataActionController } from "./layerMetadataActionController";
import type { DeleteTarget } from "./deleteTarget";

const layer = (
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
  bitmapPath: `.storyboard-workbench/layers/shot-a/${id}.png`,
  width: 100,
  height: 100,
  ...overrides
});

const projectWithLayers = (): Project =>
  ({
    id: "project",
    name: "Project",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    shots: [
      {
        id: "shot-a",
        imagePath: "/tmp/a.tif",
        fileName: "a.tif",
        order: 0,
        activeLayerId: "image",
        layers: [
          layer("image", 0, { kind: "image", name: "Image" }),
          layer("paint-a", 1),
          layer("paint-b", 2)
        ]
      }
    ],
    dialogues: []
  }) as Project;

const setupController = () => {
  let currentProject = projectWithLayers();
  const dirtyShotIds: string[][] = [];
  const deleteTargets: DeleteTarget[] = [];
  const projectUpdateOptions: Array<{
    markFileNamesUnsynced: boolean | undefined;
    recordUndo: boolean | undefined;
  }> = [];
  const shotSelectionAnchorIdRef = { current: "shot-a" as string | undefined };

  const controller = useLayerMetadataActionController({
    markShotsDirty: (shotIds) => dirtyShotIds.push(shotIds),
    setDeleteTarget: (target) => deleteTargets.push(target),
    shotSelectionAnchorIdRef,
    updateProject: (projectUpdate, markFileNamesUnsynced, recordUndo) => {
      projectUpdateOptions.push({ markFileNamesUnsynced, recordUndo });
      currentProject =
        typeof projectUpdate === "function" ? projectUpdate(currentProject) : projectUpdate;
    }
  });

  return {
    controller,
    deleteTargets,
    dirtyShotIds,
    project: () => currentProject,
    projectUpdateOptions,
    shotSelectionAnchorIdRef
  };
};

describe("useLayerMetadataActionController", () => {
  it("selects a layer without marking file names unsynced", () => {
    const { controller, deleteTargets, project, projectUpdateOptions, shotSelectionAnchorIdRef } =
      setupController();

    controller.handleSelectLayer("shot-a", "paint-a");

    expect(project().shots[0].activeLayerId).toBe("paint-a");
    expect(shotSelectionAnchorIdRef.current).toBeUndefined();
    expect(deleteTargets).toEqual([{ type: "layer", shotId: "shot-a", layerId: "paint-a" }]);
    expect(projectUpdateOptions).toEqual([
      { markFileNamesUnsynced: false, recordUndo: false }
    ]);
  });

  it("updates one layer and marks the shot dirty without marking file names unsynced", () => {
    const { controller, dirtyShotIds, project, projectUpdateOptions } = setupController();

    controller.handleUpdateLayer("shot-a", "paint-a", { opacity: 0.42, blendMode: "multiply" });

    const updatedLayer = project().shots[0].layers?.find((item) => item.id === "paint-a");
    expect(updatedLayer).toMatchObject({ opacity: 0.42, blendMode: "multiply" });
    expect(dirtyShotIds).toEqual([["shot-a"]]);
    expect(projectUpdateOptions).toEqual([
      { markFileNamesUnsynced: false, recordUndo: undefined }
    ]);
  });

  it("moves one layer and marks the shot dirty without marking file names unsynced", () => {
    const { controller, dirtyShotIds, project } = setupController();

    controller.handleMoveLayer("shot-a", "paint-b", "image", "after");

    expect(project().shots[0].layers?.map((item) => item.id)).toEqual([
      "image",
      "paint-b",
      "paint-a"
    ]);
    expect(dirtyShotIds).toEqual([["shot-a"]]);
  });

  it("updates selected layer opacity as a group action", () => {
    const { controller, dirtyShotIds, project } = setupController();

    controller.handleUpdateLayerGroupOpacity(
      "shot-a",
      ["paint-a", "paint-b"],
      -0.25,
      {
        "paint-a": 0.8,
        "paint-b": 0.5
      }
    );

    const opacityById = new Map(project().shots[0].layers?.map((item) => [item.id, item.opacity]));
    expect(opacityById.get("paint-a")).toBe(0.55);
    expect(opacityById.get("paint-b")).toBe(0.25);
    expect(dirtyShotIds).toEqual([["shot-a"]]);
  });
});
