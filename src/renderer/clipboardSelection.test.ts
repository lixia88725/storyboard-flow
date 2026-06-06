import { describe, expect, it } from "vitest";
import { bitmapLayerPath, createProject } from "../shared/projectOps";
import type { BitmapLayer, Project, Shot } from "../shared/types";
import {
  copySelectionFromProject,
  layerPasteTargetFromProject,
  shotAssetCopyPlan
} from "./clipboardSelection";

const layer = (shotId: string, id: string, patch: Partial<BitmapLayer> = {}): BitmapLayer => ({
  id,
  name: id,
  kind: "paint",
  visible: true,
  locked: false,
  opacity: 1,
  blendMode: "normal",
  order: patch.order ?? 0,
  bitmapPath: bitmapLayerPath(shotId, id),
  width: 100,
  height: 80,
  ...patch
});

const shot = (id: string, order: number, layers: BitmapLayer[]): Shot => ({
  id,
  fileName: `${id}.tiff`,
  imagePath: `/scene/${id}.tiff`,
  order,
  layers,
  activeLayerId: layers[0]?.id,
  swb: {
    version: 1,
    status: "owned",
    canvasWidth: 100,
    canvasHeight: 80,
    baseFingerprint: id
  }
});

const projectWithShots = (): Project => ({
  ...createProject(),
  shots: [
    shot("shot-a", 0, [layer("shot-a", "layer-a")]),
    shot("shot-b", 1, [layer("shot-b", "layer-b", { name: "Ink" })])
  ]
});

describe("clipboard selection", () => {
  it("copies the selected layer when the delete target is a layer", () => {
    const result = copySelectionFromProject(
      projectWithShots(),
      { type: "layer", shotId: "shot-b", layerId: "layer-b" },
      ["shot-a"]
    );

    expect(result).toEqual({
      ok: true,
      clipboard: { type: "layer", shotId: "shot-b", layerId: "layer-b" },
      status: 'Layer "Ink" copied'
    });
  });

  it("falls back to the selected storyboard when no layer is selected", () => {
    const result = copySelectionFromProject(projectWithShots(), { type: "shot" }, ["shot-b"]);

    expect(result).toEqual({
      ok: true,
      clipboard: { type: "shot", shotId: "shot-b" },
      status: "Storyboard copied"
    });
  });

  it("builds one layer asset copy per source storyboard layer", () => {
    const sourceShot = shot("source", 0, [
      layer("source", "layer-a"),
      layer("source", "layer-b", { order: 1 })
    ]);

    expect(shotAssetCopyPlan(sourceShot, "pasted")).toEqual({
      pastedShotId: "pasted",
      layerCopies: [
        {
          sourceBitmapPath: ".storyboard-workbench/layers/source/layer-a.png",
          targetBitmapPath: ".storyboard-workbench/layers/pasted/layer-a.png"
        },
        {
          sourceBitmapPath: ".storyboard-workbench/layers/source/layer-b.png",
          targetBitmapPath: ".storyboard-workbench/layers/pasted/layer-b.png"
        }
      ]
    });
  });

  it("resolves a copied layer and current target layer for paste", () => {
    const result = layerPasteTargetFromProject(
      projectWithShots(),
      { type: "layer", shotId: "shot-b", layerId: "layer-b" },
      "shot-a",
      "layer-a"
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sourceLayer.id).toBe("layer-a");
      expect(result.targetLayer.id).toBe("layer-b");
      expect(result.targetShot.id).toBe("shot-b");
    }
  });

  it("reports a clear status when pasting a layer without a layer target", () => {
    expect(
      layerPasteTargetFromProject(projectWithShots(), { type: "shot" }, "shot-a", "layer-a")
    ).toEqual({
      ok: false,
      status: "Select a layer before pasting a layer"
    });
  });
});
