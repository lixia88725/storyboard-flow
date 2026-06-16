import { describe, expect, it, vi } from "vitest";
import type { BitmapLayer, Project } from "../../shared/types";
import { applyAiProjectChange, changedAiLayerShotIds } from "./aiProjectChangeController";

const layer = (id: string, opacity = 1): BitmapLayer => ({
  id,
  kind: "paint",
  name: id,
  visible: true,
  locked: false,
  opacity,
  blendMode: "normal",
  order: 0,
  bitmapPath: `.storyboard-workbench/layers/shot/${id}.png`,
  width: 1920,
  height: 1080
});

const project = (layersByShot: Record<string, BitmapLayer[]>): Project => ({
  id: "project-1",
  name: "Project",
  shots: Object.entries(layersByShot).map(([id, layers], index) => ({
    id,
    imagePath: `/project/${id}.tiff`,
    fileName: `${id}.tiff`,
    order: index,
    activeLayerId: layers?.at(-1)?.id,
    layers
  })),
  dialogues: [],
  createdAt: "2026-06-16T00:00:00.000Z",
  updatedAt: "2026-06-16T00:00:00.000Z"
});

describe("aiProjectChangeController", () => {
  it("returns only shots with changed layers or active layer", () => {
    const currentProject = project({
      "shot-1": [layer("layer-a")],
      "shot-2": [layer("layer-b")],
      "shot-3": []
    });
    const nextProject = {
      ...currentProject,
      shots: currentProject.shots.map((shot) =>
        shot.id === "shot-2"
          ? {
              ...shot,
              layers: [layer("layer-b", 0.5)]
            }
          : shot.id === "shot-3"
            ? { ...shot, activeLayerId: "layer-new" }
            : shot
      )
    };

    expect(changedAiLayerShotIds(currentProject, nextProject)).toEqual(["shot-2", "shot-3"]);
  });

  it("applies AI project changes through the app shell callbacks", () => {
    const currentProject = project({ "shot-1": [] });
    const nextProject = {
      ...currentProject,
      shots: [
        {
          ...currentProject.shots[0],
          activeLayerId: "ai-layer",
          layers: [layer("ai-layer")]
        }
      ]
    };
    const projectRef = { current: currentProject };
    const markShotsDirty = vi.fn();
    const setAutosaveRevision = vi.fn((value: number | ((revision: number) => number)) =>
      typeof value === "function" ? value(4) : value
    );
    const setProject = vi.fn();
    const setStatus = vi.fn();
    const setWorkspaceSaveState = vi.fn();

    applyAiProjectChange({
      markShotsDirty,
      nextProject,
      nextStatus: "AI Draft layer added",
      projectRef,
      setAutosaveRevision,
      setProject,
      setStatus,
      setWorkspaceSaveState
    });

    expect(markShotsDirty).toHaveBeenCalledWith(["shot-1"]);
    expect(setProject).toHaveBeenCalledWith(nextProject);
    expect(projectRef.current).toBe(nextProject);
    expect(setWorkspaceSaveState).toHaveBeenCalledWith("saving");
    expect(setAutosaveRevision).toHaveReturnedWith(5);
    expect(setStatus).toHaveBeenCalledWith("AI Draft layer added");
  });
});
