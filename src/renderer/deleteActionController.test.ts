import { describe, expect, it, vi } from "vitest";
import type { BitmapLayer, Project, Shot } from "../shared/types";
import { useDeleteActionController } from "./deleteActionController";
import type { DeleteTarget } from "./deleteTarget";

const layer = (
  id: string,
  overrides: Partial<BitmapLayer> = {}
): BitmapLayer => ({
  id,
  kind: "paint",
  name: id,
  visible: true,
  locked: false,
  opacity: 1,
  blendMode: "normal",
  order: 0,
  bitmapPath: `.storyboard-workbench/layers/shot/${id}.png`,
  width: 100,
  height: 100,
  ...overrides
});

const shot = (
  id: string,
  order: number,
  layers: BitmapLayer[] = [layer("image", { kind: "image" })],
  activeLayerId = layers[0]?.id
): Shot =>
  ({
    id,
    imagePath: `/tmp/${id}.tif`,
    fileName: `${id}.tif`,
    order,
    activeLayerId,
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
  deleteTarget = { type: "shot" },
  project,
  selectedShotIds
}: {
  deleteTarget?: DeleteTarget;
  project: Project;
  selectedShotIds: string[];
}) => {
  const projectRef = { current: project };
  const selectedShotIdsRef = { current: selectedShotIds };
  const selectedShotIdsByCall: Array<string | undefined> = [];
  const deleteTargetsByCall: DeleteTarget[] = [];
  const statuses: string[] = [];
  const handleRemoveBitmapLayer = vi.fn(async (shotId: string, layerId: string) => {
    projectRef.current = {
      ...projectRef.current,
      shots: projectRef.current.shots.map((item) =>
        item.id === shotId
          ? {
              ...item,
              layers: item.layers?.filter((itemLayer) => itemLayer.id !== layerId),
              activeLayerId: item.layers?.find((itemLayer) => itemLayer.id !== layerId)?.id
            }
          : item
      )
    };
  });

  const controller = useDeleteActionController({
    deleteTarget,
    handleRemoveBitmapLayer,
    projectRef,
    selectedShotIdsRef,
    selectSingleShot: (shotId) => selectedShotIdsByCall.push(shotId),
    setDeleteTarget: (target) => deleteTargetsByCall.push(target),
    setStatus: (status) => statuses.push(status),
    updateProject: (projectUpdate) => {
      projectRef.current =
        typeof projectUpdate === "function" ? projectUpdate(projectRef.current) : projectUpdate;
    }
  });

  return {
    controller,
    deleteTargetsByCall,
    handleRemoveBitmapLayer,
    projectRef,
    selectedShotIdsByCall,
    statuses
  };
};

describe("useDeleteActionController", () => {
  it("deletes selected storyboards and selects the next remaining storyboard", () => {
    const { controller, deleteTargetsByCall, projectRef, selectedShotIdsByCall, statuses } =
      setupController({
        project: projectWithShots([shot("shot-a", 0), shot("shot-b", 1), shot("shot-c", 2)]),
        selectedShotIds: ["shot-b"]
      });

    controller.handleDeleteSelectedShots();

    expect(projectRef.current.shots.map((item) => item.id)).toEqual(["shot-a", "shot-c"]);
    expect(selectedShotIdsByCall).toEqual(["shot-c"]);
    expect(deleteTargetsByCall).toEqual([{ type: "shot" }]);
    expect(statuses).toEqual(["Storyboard deleted; Save will move its file to Trash"]);
  });

  it("selects the previous storyboard after deleting the last selected storyboard", () => {
    const { controller, selectedShotIdsByCall } = setupController({
      project: projectWithShots([shot("shot-a", 0), shot("shot-b", 1), shot("shot-c", 2)]),
      selectedShotIds: ["shot-c"]
    });

    controller.handleDeleteSelectedShots();

    expect(selectedShotIdsByCall).toEqual(["shot-b"]);
  });

  it("treats deleting every storyboard as a valid delete with no next selection", () => {
    const { controller, projectRef, selectedShotIdsByCall, statuses } = setupController({
      project: projectWithShots([shot("shot-a", 0), shot("shot-b", 1)]),
      selectedShotIds: ["shot-a", "shot-b"]
    });

    controller.handleDeleteSelectedShots();

    expect(projectRef.current.shots).toEqual([]);
    expect(selectedShotIdsByCall).toEqual([undefined]);
    expect(statuses).toEqual(["2 storyboards deleted; Save will move their files to Trash"]);
  });

  it("does not delete when the selected storyboard is stale", () => {
    const { controller, projectRef, selectedShotIdsByCall, statuses } = setupController({
      project: projectWithShots([shot("shot-a", 0)]),
      selectedShotIds: ["missing"]
    });

    controller.handleDeleteSelectedShots();

    expect(projectRef.current.shots.map((item) => item.id)).toEqual(["shot-a"]);
    expect(selectedShotIdsByCall).toEqual([]);
    expect(statuses).toEqual([]);
  });

  it("deletes a targeted layer and retargets delete to the next active visible layer", async () => {
    const paintLayer = layer("paint", { order: 1 });
    const imageLayer = layer("image", { kind: "image", order: 0 });
    const { controller, deleteTargetsByCall, handleRemoveBitmapLayer } = setupController({
      deleteTarget: { type: "layer", shotId: "shot-a", layerId: "paint" },
      project: projectWithShots([shot("shot-a", 0, [imageLayer, paintLayer], "paint")]),
      selectedShotIds: ["shot-a"]
    });

    await controller.handleDeleteKeyPress();

    expect(handleRemoveBitmapLayer).toHaveBeenCalledWith("shot-a", "paint");
    expect(deleteTargetsByCall).toEqual([{ type: "layer", shotId: "shot-a", layerId: "image" }]);
  });

  it("keeps locked layer delete from falling through to storyboard delete", async () => {
    const lockedLayer = layer("paint", { locked: true });
    const { controller, projectRef, statuses } = setupController({
      deleteTarget: { type: "layer", shotId: "shot-a", layerId: "paint" },
      project: projectWithShots([shot("shot-a", 0, [lockedLayer], "paint")]),
      selectedShotIds: ["shot-a"]
    });

    await controller.handleDeleteKeyPress();

    expect(projectRef.current.shots.map((item) => item.id)).toEqual(["shot-a"]);
    expect(statuses).toEqual(["Cannot delete a locked layer"]);
  });
});
