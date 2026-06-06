import { describe, expect, it } from "vitest";
import {
  addBitmapLayer,
  addDialogue,
  addImportedImages,
  addSketchLayer,
  addGeneratedShot,
  bitmapLayerPath,
  bitmapLayersForShot,
  clearBitmapLayer,
  createImageBitmapLayer,
  clearSketch,
  createRenamePlan,
  copyBitmapLayerToShot,
  copyDialogueToShot,
  deleteShots,
  deleteBitmapLayer,
  duplicateShotAfter,
  flattenSketchLayers,
  getNextStoryboardIndex,
  markBitmapLayerPainted,
  mergeBitmapLayerDown,
  mergeSelectedBitmapLayers,
  mergeExternalImageChanges,
  mergeVisibleBitmapLayers,
  moveBitmapLayer,
  moveBitmapLayerGroup,
  parkShotGroup,
  removeSketchLayer,
  reorderSketchLayer,
  moveSketchLayer,
  selectBitmapLayer,
  selectSketchLayer,
  updateBitmapLayer,
  updateBitmapLayerGroupOpacity,
  updateSketchLayer,
  updateShotBaseVisibility,
  validateRenamePlan,
  mergeFolderImages,
  moveDialogueToShot,
  projectAcceptedExternalEdits,
  projectHasSwbWarning,
  projectNeedsSwbImport,
  removeDialogue,
  restoreParkedShotGroup,
  reorderShots,
  reorderShotGroup,
  sketchLayersForShot,
  appendSketchStroke,
  appendImageLayerEdit,
  clearImageLayerEdits,
  deleteImageLayerContent,
  selectImageLayer,
  updateSketch
} from "./projectOps";
import type { Project, SketchStroke } from "./types";

const defaultLayer = () => ({
  id: "layer-default",
  name: "Drawing",
  visible: true,
  locked: false,
  opacity: 1,
  blendMode: "normal" as const,
  order: 0,
  strokes: []
});

const makeProject = (): Project => ({
  id: "project-1",
  name: "Test Project",
  createdAt: "2026-05-25T00:00:00.000Z",
  updatedAt: "2026-05-25T00:00:00.000Z",
  shots: [
    {
      id: "shot-a",
      imagePath: "/tmp/a.png",
      fileName: "a.png",
      order: 0,
      sketchLayers: [defaultLayer()]
    },
    {
      id: "shot-b",
      imagePath: "/tmp/b.png",
      fileName: "b.png",
      order: 1,
      sketchLayers: [defaultLayer()]
    },
    {
      id: "shot-c",
      imagePath: "/tmp/c.png",
      fileName: "c.png",
      order: 2,
      sketchLayers: [defaultLayer()]
    }
  ],
  dialogues: [
    {
      id: "dialogue-1",
      shotId: "shot-a",
      text: "First line",
      order: 0
    }
  ]
});

const createEmptyProject = (): Project => ({
  ...makeProject(),
  shots: [],
  dialogues: []
});

const makeBitmapProject = (): Project => ({
  ...makeProject(),
  shots: [
    {
      id: "shot-a",
      imagePath: "/tmp/a.tif",
      fileName: "a.tif",
      order: 0,
      activeLayerId: "layer-image",
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
          bitmapPath: ".storyboard-workbench/layers/shot-a/layer-image.png",
          width: 1920,
          height: 1080
        }
      ]
    }
  ],
  dialogues: []
});

describe("project operations", () => {
  it("creates Image bitmap layer metadata for a shot", () => {
    const layer = createImageBitmapLayer("shot-a", 1920, 1080);

    expect(layer).toEqual({
      id: "layer-image",
      kind: "image",
      name: "Image",
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: "normal",
      order: 0,
      bitmapPath: ".storyboard-workbench/layers/shot-a/layer-image.png",
      width: 1920,
      height: 1080
    });
    expect(bitmapLayerPath("shot-a", "paint-1")).toBe(
      ".storyboard-workbench/layers/shot-a/paint-1.png"
    );
  });

  it("adds a paint bitmap layer and selects it without touching the real image path", () => {
    const project = makeBitmapProject();

    const updated = addBitmapLayer(project, "shot-a", {
      id: "paint-1",
      name: "Paint",
      width: 1920,
      height: 1080
    });
    const shot = updated.shots[0];

    expect(shot.imagePath).toBe("/tmp/a.tif");
    expect(shot.activeLayerId).toBe("paint-1");
    expect(bitmapLayersForShot(shot).map((layer) => [layer.id, layer.kind, layer.order])).toEqual([
      ["layer-image", "image", 0],
      ["paint-1", "paint", 1]
    ]);
    expect(shot.layers?.[1]).toMatchObject({
      bitmapPath: ".storyboard-workbench/layers/shot-a/paint-1.png",
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: "normal"
    });
  });

  it("adds a paint bitmap layer with a unique path after the Image layer was removed", () => {
    const project = deleteBitmapLayer(
      addBitmapLayer(makeBitmapProject(), "shot-a", {
        id: "layer-shot-a-1",
        name: "Paint",
        width: 1920,
        height: 1080
      }),
      "shot-a",
      "layer-image"
    );

    const updated = addBitmapLayer(project, "shot-a", {
      name: "Layer",
      width: 1920,
      height: 1080
    });

    const shot = updated.shots[0];
    expect(bitmapLayersForShot(shot).map((layer) => layer.id)).toEqual([
      "layer-shot-a-1",
      "layer-shot-a-2"
    ]);
    expect(bitmapLayersForShot(shot).map((layer) => layer.bitmapPath)).toEqual([
      ".storyboard-workbench/layers/shot-a/layer-shot-a-1.png",
      ".storyboard-workbench/layers/shot-a/layer-shot-a-2.png"
    ]);
    expect(shot.activeLayerId).toBe("layer-shot-a-2");
  });

  it("copies a bitmap layer to another shot with a new layer path and preserved properties", () => {
    const sourceLayer = {
      id: "paint-source",
      kind: "paint" as const,
      name: "Shadow Pass",
      visible: true,
      locked: true,
      opacity: 0.42,
      blendMode: "multiply" as const,
      order: 1,
      bitmapPath: ".storyboard-workbench/layers/shot-a/paint-source.png",
      width: 800,
      height: 450
    };
    const project: Project = {
      ...makeBitmapProject(),
      shots: [
        {
          ...makeBitmapProject().shots[0],
          layers: [makeBitmapProject().shots[0].layers![0], sourceLayer]
        },
        {
          id: "shot-b",
          imagePath: "/tmp/b.tif",
          fileName: "b.tif",
          order: 1,
          activeLayerId: "layer-image",
          layers: [createImageBitmapLayer("shot-b", 1920, 1080)]
        }
      ]
    };

    const updated = copyBitmapLayerToShot(project, "shot-a", "paint-source", "shot-b", "paint-copy");
    const targetLayers = bitmapLayersForShot(updated.shots[1]);

    expect(targetLayers.map((layer) => layer.id)).toEqual(["layer-image", "paint-copy"]);
    expect(targetLayers[1]).toMatchObject({
      kind: "paint",
      name: "Shadow Pass",
      visible: true,
      locked: true,
      opacity: 0.42,
      blendMode: "multiply",
      bitmapPath: ".storyboard-workbench/layers/shot-b/paint-copy.png",
      width: 800,
      height: 450
    });
    expect(updated.shots[1].activeLayerId).toBe("paint-copy");
  });

  it("copies a bitmap layer into the same shot at a target layer position", () => {
    const project = addBitmapLayer(makeBitmapProject(), "shot-a", {
      id: "paint-top",
      name: "Top Paint",
      width: 1920,
      height: 1080
    });

    const updated = copyBitmapLayerToShot(
      project,
      "shot-a",
      "paint-top",
      "shot-a",
      "paint-copy",
      "layer-image",
      "after"
    );
    const layers = bitmapLayersForShot(updated.shots[0]);

    expect(layers.map((layer) => layer.id)).toEqual(["layer-image", "paint-copy", "paint-top"]);
    expect(layers[1]).toMatchObject({
      name: "Top Paint",
      bitmapPath: ".storyboard-workbench/layers/shot-a/paint-copy.png"
    });
    expect(updated.shots[0].activeLayerId).toBe("paint-copy");
  });

  it("deduplicates bitmap layers that point at the same layer asset", () => {
    const project = addBitmapLayer(makeBitmapProject(), "shot-a", {
      id: "layer-shot-a-1",
      name: "Paint",
      width: 1920,
      height: 1080
    });
    const duplicate = project.shots[0].layers?.[1];

    const layers = bitmapLayersForShot({
      ...project.shots[0],
      layers: duplicate ? [project.shots[0].layers![0], duplicate, { ...duplicate, order: 2 }] : []
    });

    expect(layers.map((layer) => layer.id)).toEqual(["layer-image", "layer-shot-a-1"]);
  });

  it("duplicates one storyboard after the drop target and copies its dialogue", () => {
    const project: Project = {
      ...makeBitmapProject(),
      shots: [
        {
          ...makeBitmapProject().shots[0],
          scriptText: "Shot A script",
          swb: {
            version: 1,
            status: "compatible-external-edit",
            canvasWidth: 1920,
            canvasHeight: 1080,
            baseFingerprint: "old",
            statusMessage: "Import needed"
          }
        },
        {
          id: "shot-b",
          imagePath: "/tmp/b.tif",
          fileName: "b.tif",
          order: 1,
          layers: [createImageBitmapLayer("shot-b", 1920, 1080)]
        }
      ],
      dialogues: [
        {
          id: "dialogue-a",
          shotId: "shot-a",
          text: "Keep this line",
          order: 0
        }
      ]
    };

    const updated = duplicateShotAfter(project, "shot-a", "shot-b", {
      shotId: "shot-copy",
      imagePath: "/tmp/a-copy.tif",
      fileName: "a-copy.tif",
      previewPath: "/tmp/a-copy-preview.png"
    });

    expect(updated.shots.map((shot) => shot.id)).toEqual(["shot-a", "shot-b", "shot-copy"]);
    const copiedShot = updated.shots[2];
    expect(copiedShot).toMatchObject({
      id: "shot-copy",
      imagePath: "/tmp/a-copy.tif",
      previewPath: "/tmp/a-copy-preview.png",
      fileName: "a-copy.tif",
      scriptText: "Shot A script",
      swb: {
        status: "owned",
        statusMessage: undefined
      }
    });
    expect(bitmapLayersForShot(copiedShot).map((layer) => layer.bitmapPath)).toEqual([
      ".storyboard-workbench/layers/shot-copy/layer-image.png"
    ]);
    expect(updated.dialogues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          shotId: "shot-copy",
          text: "Keep this line",
          order: 0
        })
      ])
    );
  });

  it("duplicates one storyboard before the insertion target when requested", () => {
    const project = makeProject();

    const updated = duplicateShotAfter(project, "shot-c", "shot-b", {
      shotId: "shot-copy",
      imagePath: "/tmp/c-copy.png",
      fileName: "c-copy.png",
      placement: "before"
    });

    expect(updated.shots.map((shot) => shot.id)).toEqual(["shot-a", "shot-copy", "shot-b", "shot-c"]);
  });

  it("copies dialogue to the target shot without moving the original", () => {
    const updated = copyDialogueToShot(makeProject(), "dialogue-1", "shot-b", "dialogue-copy");

    expect(updated.dialogues).toEqual([
      {
        id: "dialogue-1",
        shotId: "shot-a",
        text: "First line",
        order: 0
      },
      {
        id: "dialogue-copy",
        shotId: "shot-b",
        text: "First line",
        order: 0
      }
    ]);
  });

  it("restores Image metadata from scanned SWB TIFF metadata when duplicate paint layers corrupted it", () => {
    const paintLayer = {
      id: "layer-shot-a-1",
      kind: "paint" as const,
      name: "Layer",
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: "normal" as const,
      order: 0,
      bitmapPath: ".storyboard-workbench/layers/shot-a/layer-shot-a-1.png",
      width: 1920,
      height: 1080
    };
    const project: Project = {
      ...makeBitmapProject(),
      shots: [
        {
          ...makeBitmapProject().shots[0],
          layers: [paintLayer, { ...paintLayer, order: 1 }],
          activeLayerId: paintLayer.id,
          swb: {
            version: 1,
            status: "owned",
            canvasWidth: 1920,
            canvasHeight: 1080,
            baseFingerprint: "pixel-a"
          }
        }
      ]
    };

    const updated = mergeFolderImages(project, [
      {
        imagePath: "/tmp/a.tif",
        fileName: "a.tif",
        width: 1920,
        height: 1080,
        fingerprint: "pixel-a",
        swbMetadata: {
          app: "Storyboard Workbench",
          format: "swb-tiff",
          version: 1,
          shotId: "shot-a",
          canvasWidth: 1920,
          canvasHeight: 1080,
          baseFingerprint: "pixel-a",
          updatedAt: "2026-05-29T00:00:00.000Z",
          layers: [{ id: "layer-image", kind: "image" }]
        } as any
      }
    ]);

    expect(bitmapLayersForShot(updated.shots[0]).map((layer) => layer.id)).toEqual([
      "layer-image",
      "layer-shot-a-1"
    ]);
    expect(updated.shots[0].activeLayerId).toBe("layer-shot-a-1");
  });

  it("selects, updates, reorders, and deletes bitmap layers", () => {
    const project = addBitmapLayer(
      addBitmapLayer(makeBitmapProject(), "shot-a", {
        id: "paint-1",
        name: "Paint 1",
        width: 1920,
        height: 1080
      }),
      "shot-a",
      {
        id: "paint-2",
        name: "Paint 2",
        width: 1920,
        height: 1080
      }
    );

    const selected = selectBitmapLayer(project, "shot-a", "paint-1");
    expect(selected.shots[0].activeLayerId).toBe("paint-1");

    const updated = updateBitmapLayer(selected, "shot-a", "paint-1", {
      visible: false,
      opacity: 1.4,
      blendMode: "multiply"
    });
    expect(
      bitmapLayersForShot(updated.shots[0]).find((layer) => layer.id === "paint-1")
    ).toMatchObject({
      visible: false,
      opacity: 1,
      blendMode: "multiply"
    });
    expect(updated.shots[0].activeLayerId).toBe("paint-2");

    const hiddenSelection = selectBitmapLayer(updated, "shot-a", "paint-1");
    expect(hiddenSelection.shots[0].activeLayerId).toBe("paint-2");

    const moved = moveBitmapLayer(updated, "shot-a", "paint-2", "paint-1");
    expect(bitmapLayersForShot(moved.shots[0]).map((layer) => [layer.id, layer.order])).toEqual([
      ["layer-image", 0],
      ["paint-2", 1],
      ["paint-1", 2]
    ]);

    const deleted = deleteBitmapLayer(moved, "shot-a", "paint-2");
    expect(bitmapLayersForShot(deleted.shots[0]).map((layer) => layer.id)).toEqual([
      "layer-image",
      "paint-1"
    ]);
    expect(deleted.shots[0].activeLayerId).toBe("layer-image");
  });

  it("merges the active bitmap layer into the next visible layer below it", () => {
    const project = {
      ...makeBitmapProject(),
      shots: [
        {
          ...makeBitmapProject().shots[0],
          activeLayerId: "paint-top",
          layers: [
            createImageBitmapLayer("shot-a", 1920, 1080),
            {
              id: "paint-bottom",
              kind: "paint" as const,
              name: "Bottom",
              visible: true,
              locked: false,
              opacity: 0.35,
              blendMode: "multiply" as const,
              order: 1,
              bitmapPath: ".storyboard-workbench/layers/shot-a/paint-bottom.png",
              width: 1920,
              height: 1080
            },
            {
              id: "paint-hidden",
              kind: "paint" as const,
              name: "Hidden",
              visible: false,
              locked: false,
              opacity: 1,
              blendMode: "normal" as const,
              order: 2,
              bitmapPath: ".storyboard-workbench/layers/shot-a/paint-hidden.png",
              width: 1920,
              height: 1080
            },
            {
              id: "paint-top",
              kind: "paint" as const,
              name: "Top",
              visible: true,
              locked: false,
              opacity: 0.5,
              blendMode: "screen" as const,
              order: 3,
              bitmapPath: ".storyboard-workbench/layers/shot-a/paint-top.png",
              width: 1920,
              height: 1080
            }
          ]
        }
      ]
    };

    const merged = mergeBitmapLayerDown(project, "shot-a", "paint-top", "paint-bottom");
    const layers = bitmapLayersForShot(merged.shots[0]);

    expect(layers.map((layer) => [layer.id, layer.order])).toEqual([
      ["layer-image", 0],
      ["paint-bottom", 1],
      ["paint-hidden", 2]
    ]);
    expect(layers[1]).toMatchObject({
      opacity: 1,
      blendMode: "normal",
      visible: true
    });
    expect(merged.shots[0].activeLayerId).toBe("paint-bottom");
  });

  it("does not merge bitmap layers when either layer is locked", () => {
    const project = addBitmapLayer(addBitmapLayer(makeBitmapProject(), "shot-a", {
      id: "paint-bottom",
      width: 1920,
      height: 1080
    }), "shot-a", {
      id: "paint-top",
      width: 1920,
      height: 1080
    });
    const lockedTop = updateBitmapLayer(project, "shot-a", "paint-top", { locked: true });
    const lockedBottom = updateBitmapLayer(project, "shot-a", "paint-bottom", { locked: true });

    expect(mergeBitmapLayerDown(lockedTop, "shot-a", "paint-top", "paint-bottom")).toBe(lockedTop);
    expect(mergeBitmapLayerDown(lockedBottom, "shot-a", "paint-top", "paint-bottom")).toBe(lockedBottom);
  });

  it("merges selected bitmap layers into the bottom selected layer", () => {
    const project = addBitmapLayer(addBitmapLayer(addBitmapLayer(makeBitmapProject(), "shot-a", {
      id: "paint-bottom",
      width: 1920,
      height: 1080
    }), "shot-a", {
      id: "paint-middle",
      width: 1920,
      height: 1080
    }), "shot-a", {
      id: "paint-top",
      width: 1920,
      height: 1080
    });
    const withLayerState = updateBitmapLayer(
      updateBitmapLayer(project, "shot-a", "paint-bottom", { opacity: 0.5, blendMode: "multiply" }),
      "shot-a",
      "paint-top",
      { opacity: 0.4, blendMode: "screen" }
    );

    const merged = mergeSelectedBitmapLayers(withLayerState, "shot-a", [
      "paint-top",
      "paint-bottom"
    ]);
    const layers = bitmapLayersForShot(merged.shots[0]);

    expect(layers.map((layer) => [layer.id, layer.order])).toEqual([
      ["layer-image", 0],
      ["paint-bottom", 1],
      ["paint-middle", 2]
    ]);
    expect(layers[1]).toMatchObject({
      id: "paint-bottom",
      visible: true,
      opacity: 1,
      blendMode: "normal"
    });
    expect(merged.shots[0].activeLayerId).toBe("paint-bottom");
  });

  it("does not merge selected bitmap layers when any selected layer is locked or hidden", () => {
    const project = addBitmapLayer(addBitmapLayer(makeBitmapProject(), "shot-a", {
      id: "paint-bottom",
      width: 1920,
      height: 1080
    }), "shot-a", {
      id: "paint-top",
      width: 1920,
      height: 1080
    });
    const locked = updateBitmapLayer(project, "shot-a", "paint-top", { locked: true });
    const hidden = updateBitmapLayer(project, "shot-a", "paint-top", { visible: false });

    expect(mergeSelectedBitmapLayers(locked, "shot-a", ["paint-bottom", "paint-top"])).toBe(locked);
    expect(mergeSelectedBitmapLayers(hidden, "shot-a", ["paint-bottom", "paint-top"])).toBe(hidden);
    expect(mergeSelectedBitmapLayers(project, "shot-a", ["paint-top"])).toBe(project);
  });

  it("merges all visible bitmap layers into the bottom visible layer and keeps hidden layers", () => {
    const project = addBitmapLayer(addBitmapLayer(addBitmapLayer(makeBitmapProject(), "shot-a", {
      id: "paint-bottom",
      width: 1920,
      height: 1080
    }), "shot-a", {
      id: "paint-hidden",
      width: 1920,
      height: 1080
    }), "shot-a", {
      id: "paint-top",
      width: 1920,
      height: 1080
    });
    const withLayerState = updateBitmapLayer(
      updateBitmapLayer(
        updateBitmapLayer(project, "shot-a", "layer-image", { opacity: 0.4, blendMode: "multiply" }),
        "shot-a",
        "paint-hidden",
        { visible: false }
      ),
      "shot-a",
      "paint-top",
      { opacity: 0.5, blendMode: "screen" }
    );

    const merged = mergeVisibleBitmapLayers(withLayerState, "shot-a");
    const layers = bitmapLayersForShot(merged.shots[0]);

    expect(layers.map((layer) => [layer.id, layer.order])).toEqual([
      ["paint-hidden", 0],
      ["layer-shot-a-4", 1]
    ]);
    expect(layers[0]).toMatchObject({
      id: "paint-hidden",
      visible: false
    });
    expect(layers[1]).toMatchObject({
      id: "layer-shot-a-4",
      kind: "paint",
      name: "Merged",
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: "normal",
      bitmapPath: ".storyboard-workbench/layers/shot-a/layer-shot-a-4.png"
    });
    expect(merged.shots[0].activeLayerId).toBe("layer-shot-a-4");
  });

  it("merges locked visible bitmap layers while keeping them hidden", () => {
    const project = addBitmapLayer(makeBitmapProject(), "shot-a", {
      id: "paint-top",
      width: 1920,
      height: 1080
    });
    const locked = updateBitmapLayer(project, "shot-a", "paint-top", { locked: true });

    const merged = mergeVisibleBitmapLayers(locked, "shot-a");
    const layers = bitmapLayersForShot(merged.shots[0]);

    expect(layers.map((layer) => [layer.id, layer.visible, layer.locked])).toEqual([
      ["paint-top", false, true],
      ["layer-shot-a-2", true, false]
    ]);
    expect(layers[1]).toMatchObject({
      name: "Merged",
      opacity: 1,
      blendMode: "normal"
    });
    expect(merged.shots[0].activeLayerId).toBe("layer-shot-a-2");
  });

  it("does not merge visible bitmap layers when fewer than two layers are visible", () => {
    const project = updateBitmapLayer(makeBitmapProject(), "shot-a", "layer-image", { visible: false });

    expect(mergeVisibleBitmapLayers(project, "shot-a")).toBe(project);
  });

  it("moves the Image bitmap layer like an ordinary layer", () => {
    const project = addBitmapLayer(makeBitmapProject(), "shot-a", {
      id: "paint-1",
      name: "Paint",
      width: 1920,
      height: 1080
    });

    const movedAbove = moveBitmapLayer(project, "shot-a", "layer-image", "paint-1", "after");
    expect(bitmapLayersForShot(movedAbove.shots[0]).map((layer) => [layer.id, layer.order])).toEqual([
      ["paint-1", 0],
      ["layer-image", 1]
    ]);

    const movedBelow = moveBitmapLayer(movedAbove, "shot-a", "layer-image", "paint-1");
    expect(bitmapLayersForShot(movedBelow.shots[0]).map((layer) => [layer.id, layer.order])).toEqual([
      ["layer-image", 0],
      ["paint-1", 1]
    ]);
  });

  it("moves an unlocked bitmap layer group as a block while leaving locked selected layers in place", () => {
    const project = {
      ...makeBitmapProject(),
      shots: [
        {
          ...makeBitmapProject().shots[0],
          activeLayerId: "paint-locked",
          layers: [
            createImageBitmapLayer("shot-a", 1920, 1080),
            {
              id: "paint-a",
              kind: "paint" as const,
              name: "A",
              visible: true,
              locked: false,
              opacity: 1,
              blendMode: "normal" as const,
              order: 1,
              bitmapPath: ".storyboard-workbench/layers/shot-a/paint-a.png",
              width: 1920,
              height: 1080
            },
            {
              id: "paint-locked",
              kind: "paint" as const,
              name: "Locked",
              visible: true,
              locked: true,
              opacity: 0.5,
              blendMode: "normal" as const,
              order: 2,
              bitmapPath: ".storyboard-workbench/layers/shot-a/paint-locked.png",
              width: 1920,
              height: 1080
            },
            {
              id: "paint-b",
              kind: "paint" as const,
              name: "B",
              visible: true,
              locked: false,
              opacity: 1,
              blendMode: "normal" as const,
              order: 3,
              bitmapPath: ".storyboard-workbench/layers/shot-a/paint-b.png",
              width: 1920,
              height: 1080
            },
            {
              id: "paint-target",
              kind: "paint" as const,
              name: "Target",
              visible: true,
              locked: false,
              opacity: 1,
              blendMode: "normal" as const,
              order: 4,
              bitmapPath: ".storyboard-workbench/layers/shot-a/paint-target.png",
              width: 1920,
              height: 1080
            }
          ]
        }
      ]
    };

    const moved = moveBitmapLayerGroup(
      project,
      "shot-a",
      ["paint-a", "paint-locked", "paint-b"],
      "layer-image",
      "before"
    );

    expect(bitmapLayersForShot(moved.shots[0]).map((layer) => [layer.id, layer.order])).toEqual([
      ["paint-a", 0],
      ["paint-b", 1],
      ["layer-image", 2],
      ["paint-locked", 3],
      ["paint-target", 4]
    ]);
    expect(moved.shots[0].activeLayerId).toBe("paint-b");
    expect(moveBitmapLayerGroup(project, "shot-a", ["paint-a", "paint-b"], "paint-a", "after")).toBe(project);
  });

  it("adjusts bitmap layer group opacity by delta while skipping locked and unselected layers", () => {
    const project = {
      ...makeBitmapProject(),
      shots: [
        {
          ...makeBitmapProject().shots[0],
          layers: [
            { ...createImageBitmapLayer("shot-a", 1920, 1080), opacity: 0.2 },
            {
              id: "paint-a",
              kind: "paint" as const,
              name: "A",
              visible: true,
              locked: false,
              opacity: 0.65,
              blendMode: "normal" as const,
              order: 1,
              bitmapPath: ".storyboard-workbench/layers/shot-a/paint-a.png",
              width: 1920,
              height: 1080
            },
            {
              id: "paint-locked",
              kind: "paint" as const,
              name: "Locked",
              visible: true,
              locked: true,
              opacity: 0.5,
              blendMode: "normal" as const,
              order: 2,
              bitmapPath: ".storyboard-workbench/layers/shot-a/paint-locked.png",
              width: 1920,
              height: 1080
            }
          ]
        }
      ]
    };

    const updated = updateBitmapLayerGroupOpacity(
      project,
      "shot-a",
      ["layer-image", "paint-a", "paint-locked"],
      0.4
    );

    expect(bitmapLayersForShot(updated.shots[0]).map((layer) => [layer.id, layer.opacity])).toEqual([
      ["layer-image", 0.6],
      ["paint-a", 1],
      ["paint-locked", 0.5]
    ]);
  });

  it("deletes the Image bitmap layer when another layer remains", () => {
    const project = addBitmapLayer(makeBitmapProject(), "shot-a", {
      id: "paint-1",
      name: "Paint",
      width: 1920,
      height: 1080
    });

    const deleted = deleteBitmapLayer(project, "shot-a", "layer-image");

    expect(bitmapLayersForShot(deleted.shots[0]).map((layer) => layer.id)).toEqual(["paint-1"]);
    expect(deleted.shots[0].activeLayerId).toBe("paint-1");
  });

  it("keeps locked bitmap layer content-affecting metadata unchanged while allowing visibility and unlock", () => {
    const project = makeBitmapProject();
    const locked = updateBitmapLayer(project, "shot-a", "layer-image", { locked: true });
    const updated = updateBitmapLayer(locked, "shot-a", "layer-image", {
      name: "Renamed",
      visible: false,
      locked: false,
      opacity: 0.25,
      blendMode: "screen"
    });

    expect(bitmapLayersForShot(updated.shots[0]).find((layer) => layer.id === "layer-image")).toMatchObject({
      name: "Image",
      visible: false,
      locked: false,
      opacity: 1,
      blendMode: "normal"
    });
  });

  it("does not delete the Image bitmap layer when it is the only layer", () => {
    const project = makeBitmapProject();

    const deleted = deleteBitmapLayer(project, "shot-a", "layer-image");

    expect(bitmapLayersForShot(deleted.shots[0]).map((layer) => layer.id)).toEqual(["layer-image"]);
    expect(deleted.shots[0].activeLayerId).toBe("layer-image");
  });

  it("clears the Image bitmap layer without deleting its metadata", () => {
    const project = makeBitmapProject();

    const updated = clearBitmapLayer(project, "shot-a", "layer-image");

    expect(updated.shots[0].activeLayerId).toBe("layer-image");
    expect(bitmapLayersForShot(updated.shots[0])).toEqual([
      {
        id: "layer-image",
        kind: "image",
        name: "Image",
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: "normal",
        order: 0,
        bitmapPath: ".storyboard-workbench/layers/shot-a/layer-image.png",
        width: 1920,
        height: 1080,
        cleared: true
      }
    ]);
  });

  it("marks a cleared bitmap layer as painted again", () => {
    const cleared = clearBitmapLayer(makeBitmapProject(), "shot-a", "layer-image");

    const updated = markBitmapLayerPainted(cleared, "shot-a", "layer-image");

    expect(bitmapLayersForShot(updated.shots[0])[0]).not.toHaveProperty("cleared");
    expect(updated.shots[0].activeLayerId).toBe("layer-image");
  });

  it("reorders shots and normalizes their order values", () => {
    const project = makeProject();

    const updated = reorderShots(project, "shot-c", "shot-a");

    expect(updated.shots.map((shot) => [shot.id, shot.order])).toEqual([
      ["shot-c", 0],
      ["shot-a", 1],
      ["shot-b", 2]
    ]);
    expect(project.shots.map((shot) => shot.id)).toEqual(["shot-a", "shot-b", "shot-c"]);
  });

  it("moves a shot forward before a later target", () => {
    const project = makeProject();

    const updated = reorderShots(project, "shot-a", "shot-c", "before");

    expect(updated.shots.map((shot) => [shot.id, shot.order])).toEqual([
      ["shot-b", 0],
      ["shot-a", 1],
      ["shot-c", 2]
    ]);
  });

  it("moves selected shots as a group while preserving their internal order", () => {
    const project: Project = {
      ...makeProject(),
      shots: [
        ...makeProject().shots,
        {
          id: "shot-d",
          imagePath: "/tmp/d.png",
          fileName: "d.png",
          order: 3,
          sketchLayers: []
        }
      ]
    };

    const updated = reorderShotGroup(project, ["shot-b", "shot-c"], "shot-a");

    expect(updated.shots.map((shot) => [shot.id, shot.order])).toEqual([
      ["shot-b", 0],
      ["shot-c", 1],
      ["shot-a", 2],
      ["shot-d", 3]
    ]);
  });

  it("moves selected shots after a later target when requested", () => {
    const project: Project = {
      ...makeProject(),
      shots: [
        ...makeProject().shots,
        {
          id: "shot-d",
          imagePath: "/tmp/d.png",
          fileName: "d.png",
          order: 3,
          sketchLayers: []
        }
      ]
    };

    const updated = reorderShotGroup(project, ["shot-a", "shot-b"], "shot-d", "after");

    expect(updated.shots.map((shot) => [shot.id, shot.order])).toEqual([
      ["shot-c", 0],
      ["shot-d", 1],
      ["shot-a", 2],
      ["shot-b", 3]
    ]);
  });

  it("parks selected storyboards without deleting files or dialogues", () => {
    const project = {
      ...addDialogue(makeProject(), "shot-b", "Second line", "dialogue-2"),
      pendingDeletedShots: [{ id: "deleted", imagePath: "/tmp/deleted.png", fileName: "deleted.png" }]
    };

    const updated = parkShotGroup(project, ["shot-b", "shot-c"]);

    expect(updated.shots.map((shot) => [shot.id, shot.order])).toEqual([
      ["shot-a", 0]
    ]);
    expect(updated.parkedShots?.map((shot) => [shot.id, shot.order])).toEqual([
      ["shot-b", 0],
      ["shot-c", 1]
    ]);
    expect(updated.dialogues.filter((dialogue) => dialogue.shotId === "shot-b")).toHaveLength(1);
    expect(updated.pendingDeletedShots).toEqual(project.pendingDeletedShots);
  });

  it("parks selected storyboards at a requested pending position", () => {
    const project = parkShotGroup(makeProject(), ["shot-c"]);

    const before = parkShotGroup(project, ["shot-a"], {
      targetParkedShotId: "shot-c",
      placement: "before"
    });
    expect(before.parkedShots?.map((shot) => [shot.id, shot.order])).toEqual([
      ["shot-a", 0],
      ["shot-c", 1]
    ]);

    const after = parkShotGroup(project, ["shot-a"], {
      targetParkedShotId: "shot-c",
      placement: "after"
    });
    expect(after.parkedShots?.map((shot) => [shot.id, shot.order])).toEqual([
      ["shot-c", 0],
      ["shot-a", 1]
    ]);
  });

  it("restores parked storyboards into the main shot order", () => {
    const parked = parkShotGroup(addDialogue(makeProject(), "shot-b", "Second line", "dialogue-2"), ["shot-b", "shot-c"]);

    const restored = restoreParkedShotGroup(parked, ["shot-b", "shot-c"], "shot-a", "after");

    expect(restored.shots.map((shot) => [shot.id, shot.order])).toEqual([
      ["shot-a", 0],
      ["shot-b", 1],
      ["shot-c", 2]
    ]);
    expect(restored.parkedShots).toBeUndefined();
    expect(restored.dialogues.filter((dialogue) => dialogue.shotId === "shot-b")).toHaveLength(1);
  });

  it("does not import parked storyboard files as new folder images", () => {
    const parked = parkShotGroup(makeProject(), ["shot-b"]);
    const updated = mergeFolderImages(parked, [
      {
        imagePath: "/tmp/b.png",
        fileName: "b.png",
        width: 1920,
        height: 1080,
        fingerprint: "parked-pixels"
      },
      {
        imagePath: "/tmp/new.png",
        fileName: "new.png",
        width: 1920,
        height: 1080,
        fingerprint: "new-pixels"
      }
    ]);

    expect(updated.shots.map((shot) => shot.imagePath)).toEqual(["/tmp/new.png"]);
    expect(updated.parkedShots?.map((shot) => shot.id)).toEqual(["shot-b"]);
  });

  it("deletes selected shots, records pending deleted files, and removes their dialogues", () => {
    const project = addDialogue(makeProject(), "shot-b", "Second line", "dialogue-2");

    const updated = deleteShots(project, ["shot-b"]);

    expect(updated.shots.map((shot) => [shot.id, shot.order])).toEqual([
      ["shot-a", 0],
      ["shot-c", 1]
    ]);
    expect(updated.dialogues.map((dialogue) => dialogue.id)).toEqual(["dialogue-1"]);
    expect(updated.pendingDeletedShots).toEqual([
      {
        id: "shot-b",
        imagePath: "/tmp/b.png",
        fileName: "b.png"
      }
    ]);
    expect(project.pendingDeletedShots).toBeUndefined();
  });

  it("deletes multiple selected shots and keeps order continuous", () => {
    const updated = deleteShots(makeProject(), ["shot-a", "shot-c"]);

    expect(updated.shots.map((shot) => [shot.id, shot.order])).toEqual([["shot-b", 0]]);
    expect(updated.dialogues).toEqual([]);
    expect(updated.pendingDeletedShots?.map((shot) => shot.id)).toEqual(["shot-a", "shot-c"]);
  });

  it("does not re-add pending deleted shots when appending imported folder images", () => {
    const project = deleteShots(makeProject(), ["shot-b"]);

    const updated = addImportedImages(project, [
      { imagePath: "/tmp/a.png", fileName: "a.png" },
      { imagePath: "/tmp/b.png", fileName: "b.png" },
      { imagePath: "/tmp/c.png", fileName: "c.png" },
      { imagePath: "/tmp/d.png", fileName: "d.png" }
    ]);

    expect(updated.shots.map((shot) => shot.imagePath)).toEqual([
      "/tmp/a.png",
      "/tmp/c.png",
      "/tmp/d.png"
    ]);
    expect(updated.shots.map((shot) => shot.order)).toEqual([0, 1, 2]);
    expect(updated.pendingDeletedShots?.map((shot) => shot.id)).toEqual(["shot-b"]);
  });

  it("keeps the same project object when no imported folder images are new", () => {
    const project = makeProject();

    const updated = addImportedImages(project, [
      { imagePath: "/tmp/a.png", fileName: "a.png" },
      { imagePath: "/tmp/b.png", fileName: "b.png" },
      { imagePath: "/tmp/c.png", fileName: "c.png" }
    ]);

    expect(updated).toBe(project);
  });

  it("ignores pending deleted image paths when merging folder images", () => {
    const project = deleteShots(makeProject(), ["shot-b"]);

    const merged = mergeFolderImages(project, [
      { imagePath: "/tmp/a.png", fileName: "a.png" },
      { imagePath: "/tmp/b.png", fileName: "b.png" },
      { imagePath: "/tmp/c.png", fileName: "c.png" }
    ]);

    expect(merged.shots.map((shot) => shot.id)).toEqual(["shot-a", "shot-c"]);
    expect(merged.pendingDeletedShots?.map((shot) => shot.id)).toEqual(["shot-b"]);
  });

  it("navigates storyboard grid horizontally and vertically by column count", () => {
    expect(getNextStoryboardIndex(1, 6, 3, "right")).toBe(2);
    expect(getNextStoryboardIndex(1, 6, 3, "left")).toBe(0);
    expect(getNextStoryboardIndex(1, 6, 3, "down")).toBe(4);
    expect(getNextStoryboardIndex(4, 6, 3, "up")).toBe(1);
  });

  it("clamps storyboard grid navigation at the edges", () => {
    expect(getNextStoryboardIndex(0, 6, 3, "left")).toBe(0);
    expect(getNextStoryboardIndex(2, 6, 3, "right")).toBe(2);
    expect(getNextStoryboardIndex(4, 6, 3, "down")).toBe(4);
    expect(getNextStoryboardIndex(1, 6, 3, "up")).toBe(1);
  });

  it("uses linear left and right navigation in animation mode", () => {
    expect(getNextStoryboardIndex(2, 6, 3, "right", true)).toBe(3);
    expect(getNextStoryboardIndex(2, 6, 3, "left", true)).toBe(1);
    expect(getNextStoryboardIndex(2, 6, 3, "down", true)).toBe(2);
    expect(getNextStoryboardIndex(2, 6, 3, "up", true)).toBe(2);
  });

  it("moves a dialogue to another shot and appends it after existing dialogue", () => {
    const project = addDialogue(makeProject(), "shot-b", "Existing on B", "dialogue-2");

    const updated = moveDialogueToShot(project, "dialogue-1", "shot-b");
    const moved = updated.dialogues.find((dialogue) => dialogue.id === "dialogue-1");

    expect(moved).toMatchObject({
      id: "dialogue-1",
      shotId: "shot-b",
      order: 1
    });
  });

  it("removes an empty dialogue and normalizes remaining dialogue order", () => {
    const project = addDialogue(
      addDialogue(makeProject(), "shot-a", "", "dialogue-2"),
      "shot-a",
      "Last line",
      "dialogue-3"
    );

    const updated = removeDialogue(project, "dialogue-2");

    expect(updated.dialogues.map((dialogue) => [dialogue.id, dialogue.order])).toEqual([
      ["dialogue-1", 0],
      ["dialogue-3", 1]
    ]);
  });

  it("updates sketch layer strokes for one shot without touching other shots", () => {
    const project = makeProject();
    const stroke: SketchStroke = {
      id: "stroke-1",
      tool: "brush",
      color: "#f15b2a",
      size: 5,
      points: [0, 0, 20, 20]
    };

    const updated = updateSketch(project, "shot-b", [stroke]);

    expect(updated.shots.find((shot) => shot.id === "shot-b")?.sketchLayers?.[0].strokes).toEqual([
      stroke
    ]);
    expect(updated.shots.find((shot) => shot.id === "shot-a")?.sketchLayers?.[0].strokes).toEqual(
      []
    );
  });

  it("clears sketch layer strokes for one shot", () => {
    const stroke: SketchStroke = {
      id: "stroke-1",
      tool: "brush",
      color: "#f15b2a",
      size: 5,
      points: [0, 0, 20, 20]
    };
    const project = updateSketch(makeProject(), "shot-a", [stroke]);

    const updated = clearSketch(project, "shot-a");

    expect(updated.shots.find((shot) => shot.id === "shot-a")?.sketchLayers?.[0].strokes).toEqual(
      []
    );
  });

  it("adds and selects a new sketch layer", () => {
    const updated = addSketchLayer(makeProject(), "shot-a", "Ink");
    const shot = updated.shots.find((item) => item.id === "shot-a");

    expect(shot?.activeSketchLayerId).toBe("layer-shot-a-1");
    expect(shot?.activeLayerTarget).toBe("sketch");
    expect(shot?.sketchLayers).toMatchObject([
      { id: "layer-default", name: "Drawing", order: 0 },
      { id: "layer-shot-a-1", name: "Ink", order: 1, visible: true, locked: false, opacity: 1 }
    ]);
  });

  it("updates sketch layer metadata without changing strokes", () => {
    const project = addSketchLayer(makeProject(), "shot-a", "Ink");

    const updated = updateSketchLayer(project, "shot-a", "layer-shot-a-1", {
      name: "Shadow",
      visible: false,
      locked: true,
      opacity: 0.35,
      blendMode: "multiply"
    });

    expect(updated.shots.find((shot) => shot.id === "shot-a")?.sketchLayers?.[1]).toMatchObject({
      name: "Shadow",
      visible: false,
      locked: true,
      opacity: 0.35,
      blendMode: "multiply",
      strokes: []
    });
  });

  it("appends strokes only to the active sketch layer", () => {
    const strokeA: SketchStroke = {
      id: "stroke-a",
      tool: "brush",
      color: "#111111",
      size: 4,
      points: [0, 0, 10, 10]
    };
    const strokeB: SketchStroke = {
      id: "stroke-b",
      tool: "brush",
      color: "#222222",
      size: 6,
      points: [10, 10, 20, 20]
    };
    const project = addSketchLayer(makeProject(), "shot-a", "Ink");

    const updated = appendSketchStroke(project, "shot-a", "layer-shot-a-1", strokeA);
    const locked = updateSketchLayer(updated, "shot-a", "layer-shot-a-1", { locked: true });
    const appendedWhileLocked = appendSketchStroke(locked, "shot-a", "layer-shot-a-1", strokeB);

    expect(updated.shots.find((shot) => shot.id === "shot-a")?.sketchLayers?.[0].strokes).toEqual(
      []
    );
    expect(updated.shots.find((shot) => shot.id === "shot-a")?.sketchLayers?.[1].strokes).toEqual([
      strokeA
    ]);
    expect(
      appendedWhileLocked.shots.find((shot) => shot.id === "shot-a")?.sketchLayers?.[1].strokes
    ).toEqual([strokeA, strokeB]);
  });

  it("clears only the selected sketch layer", () => {
    const strokeA: SketchStroke = {
      id: "stroke-a",
      tool: "brush",
      color: "#111111",
      size: 4,
      points: [0, 0, 10, 10]
    };
    const strokeB: SketchStroke = {
      id: "stroke-b",
      tool: "brush",
      color: "#222222",
      size: 6,
      points: [10, 10, 20, 20]
    };
    const withLayer = addSketchLayer(makeProject(), "shot-a", "Ink");
    const withDefaultStroke = updateSketch(withLayer, "shot-a", [strokeA], "layer-default");
    const withInkStroke = appendSketchStroke(withDefaultStroke, "shot-a", "layer-shot-a-1", strokeB);

    const updated = clearSketch(withInkStroke, "shot-a", "layer-shot-a-1");

    expect(updated.shots.find((shot) => shot.id === "shot-a")?.sketchLayers?.[0].strokes).toEqual([
      strokeA
    ]);
    expect(updated.shots.find((shot) => shot.id === "shot-a")?.sketchLayers?.[1].strokes).toEqual(
      []
    );
  });

  it("removes a sketch layer and keeps at least one active layer", () => {
    const project = addSketchLayer(makeProject(), "shot-a", "Ink");

    const updated = removeSketchLayer(project, "shot-a", "layer-shot-a-1");

    expect(updated.shots.find((shot) => shot.id === "shot-a")?.sketchLayers).toHaveLength(1);
    expect(updated.shots.find((shot) => shot.id === "shot-a")?.activeSketchLayerId).toBe(
      "layer-default"
    );
  });

  it("reorders sketch layers and normalizes their order values", () => {
    const project = addSketchLayer(addSketchLayer(makeProject(), "shot-a", "Ink"), "shot-a", "FX");

    const updated = reorderSketchLayer(project, "shot-a", "layer-shot-a-2", "up");

    expect(
      updated.shots.find((shot) => shot.id === "shot-a")?.sketchLayers?.map((layer) => [
        layer.id,
        layer.order
      ])
    ).toEqual([
      ["layer-default", 0],
      ["layer-shot-a-2", 1],
      ["layer-shot-a-1", 2]
    ]);
  });

  it("moves a sketch layer before a target layer by drag order", () => {
    const project = addSketchLayer(addSketchLayer(makeProject(), "shot-a", "Ink"), "shot-a", "FX");

    const updated = moveSketchLayer(project, "shot-a", "layer-shot-a-2", "layer-default");

    expect(
      updated.shots.find((shot) => shot.id === "shot-a")?.sketchLayers?.map((layer) => [
        layer.id,
        layer.order
      ])
    ).toEqual([
      ["layer-shot-a-2", 0],
      ["layer-default", 1],
      ["layer-shot-a-1", 2]
    ]);
  });

  it("selects an existing unlocked sketch layer", () => {
    const project = addSketchLayer(makeProject(), "shot-a", "Ink");

    const updated = selectSketchLayer(project, "shot-a", "layer-default");

    expect(updated.shots.find((shot) => shot.id === "shot-a")?.activeSketchLayerId).toBe(
      "layer-default"
    );
  });

  it("updates base image visibility without touching sketch layers", () => {
    const project = updateSketchLayer(addSketchLayer(makeProject(), "shot-a", "Ink"), "shot-a", "layer-shot-a-1", {
      name: "Ink"
    });

    const updated = updateShotBaseVisibility(project, "shot-a", false);

    expect(updated.shots.find((shot) => shot.id === "shot-a")?.baseVisible).toBe(false);
    expect(updated.shots.find((shot) => shot.id === "shot-a")?.sketchLayers).toHaveLength(2);
    expect(updated.shots.find((shot) => shot.id === "shot-b")?.baseVisible).toBeUndefined();
  });

  it("selects the image layer without changing sketch layers", () => {
    const project = addSketchLayer(makeProject(), "shot-a", "Ink");

    const updated = selectImageLayer(project, "shot-a");

    expect(updated.shots.find((shot) => shot.id === "shot-a")?.activeLayerTarget).toBe("image");
    expect(updated.shots.find((shot) => shot.id === "shot-a")?.sketchLayers).toHaveLength(2);
  });

  it("appends image layer edits without changing sketch layers", () => {
    const stroke: SketchStroke = {
      id: "image-stroke",
      tool: "brush",
      color: "#111111",
      size: 4,
      points: [0, 0, 10, 10]
    };
    const project = addSketchLayer(makeProject(), "shot-a", "Ink");

    const updated = appendImageLayerEdit(project, "shot-a", stroke);

    expect(updated.shots.find((shot) => shot.id === "shot-a")?.imageLayerEdits).toEqual([stroke]);
    expect(updated.shots.find((shot) => shot.id === "shot-a")?.sketchLayers?.[0].strokes).toEqual(
      []
    );
    expect(updated.shots.find((shot) => shot.id === "shot-a")?.activeLayerTarget).toBe("image");
  });

  it("appends image layer eraser edits without changing sketch layers", () => {
    const stroke: SketchStroke = {
      id: "image-eraser",
      tool: "eraser",
      color: "#ffffff",
      size: 18,
      points: [0, 0, 10, 10]
    };
    const project = addSketchLayer(makeProject(), "shot-a", "Ink");

    const updated = appendImageLayerEdit(project, "shot-a", stroke);

    expect(updated.shots.find((shot) => shot.id === "shot-a")?.imageLayerEdits).toEqual([stroke]);
    expect(updated.shots.find((shot) => shot.id === "shot-a")?.sketchLayers).toHaveLength(2);
  });

  it("clears image layer edits without changing sketch layers", () => {
    const stroke: SketchStroke = {
      id: "image-stroke",
      tool: "brush",
      color: "#111111",
      size: 4,
      points: [0, 0, 10, 10]
    };
    const project = appendImageLayerEdit(addSketchLayer(makeProject(), "shot-a", "Ink"), "shot-a", stroke);

    const updated = clearImageLayerEdits(project, "shot-a");

    expect(updated.shots.find((shot) => shot.id === "shot-a")?.imageLayerEdits).toEqual([]);
    expect(updated.shots.find((shot) => shot.id === "shot-a")?.sketchLayers).toHaveLength(2);
  });

  it("deletes image layer content without changing sketch layers", () => {
    const stroke: SketchStroke = {
      id: "image-stroke",
      tool: "brush",
      color: "#111111",
      size: 4,
      points: [0, 0, 10, 10]
    };
    const project = appendImageLayerEdit(addSketchLayer(makeProject(), "shot-a", "Ink"), "shot-a", stroke);

    const updated = deleteImageLayerContent(project, "shot-a");
    const shot = updated.shots.find((item) => item.id === "shot-a");

    expect(shot?.baseVisible).toBe(false);
    expect(shot?.imageLayerEdits).toEqual([]);
    expect(shot?.activeLayerTarget).toBe("image");
    expect(shot?.sketchLayers).toHaveLength(2);
  });

  it("flattens visible sketch layers in order and applies layer opacity", () => {
    const strokeA: SketchStroke = {
      id: "stroke-a",
      tool: "brush",
      color: "#111111",
      opacity: 0.5,
      size: 4,
      points: [0, 0, 10, 10]
    };
    const strokeB: SketchStroke = {
      id: "stroke-b",
      tool: "brush",
      color: "#222222",
      size: 6,
      points: [10, 10, 20, 20]
    };

    expect(
      flattenSketchLayers([
        {
          id: "hidden",
          name: "Hidden",
          visible: false,
          locked: false,
          opacity: 1,
          order: 0,
          strokes: [strokeA]
        },
        {
          id: "visible",
          name: "Visible",
          visible: true,
          locked: false,
          opacity: 0.25,
          order: 1,
          strokes: [strokeB]
        }
      ])
    ).toEqual([{ ...strokeB, opacity: 0.25 }]);
  });

  it("merges a folder scan with saved metadata and preserves shot data", () => {
    const project = updateSketch(makeProject(), "shot-b", [
      {
        id: "stroke-1",
        tool: "brush",
        color: "#f15b2a",
        size: 5,
        points: [0, 0, 20, 20]
      }
    ]);

    const updated = mergeFolderImages(project, [
      { imagePath: "/tmp/b.png", fileName: "b.png" },
      { imagePath: "/tmp/d.png", fileName: "d.png" }
    ]);

    expect(updated.shots.map((shot) => [shot.imagePath, shot.order])).toEqual([
      ["/tmp/b.png", 0],
      ["/tmp/d.png", 1]
    ]);
    expect(updated.shots[0].sketchLayers?.[0].strokes).toHaveLength(1);
    expect(updated.dialogues).toEqual([]);
  });

  it("adds bitmap layer metadata to legacy stroke shots during folder merge", () => {
    const project = addSketchLayer(makeProject(), "shot-a", "Ink");

    const updated = mergeFolderImages(project, [
      {
        imagePath: "/tmp/a.png",
        fileName: "a.png",
        width: 1920,
        height: 1080,
        fingerprint: "pixel-a"
      }
    ]);
    const shot = updated.shots[0];

    expect(bitmapLayersForShot(shot).map((layer) => [layer.id, layer.kind, layer.name])).toEqual([
      ["layer-image", "image", "Image"],
      ["layer-shot-a-1", "paint", "Ink"]
    ]);
    expect(shot.activeLayerId).toBe("layer-image");
    expect(shot.sketchLayers).toHaveLength(2);
  });

  it("marks newly scanned non-SWB images as needing import", () => {
    const updated = mergeFolderImages(makeProject(), [
      {
        imagePath: "/tmp/a.png",
        fileName: "a.png",
        width: 1920,
        height: 1080,
        fingerprint: "pixel-a"
      }
    ]);

    expect(updated.shots[0].swb).toMatchObject({
      status: "non-swb",
      canvasWidth: 1920,
      canvasHeight: 1080,
      baseFingerprint: "pixel-a"
    });
    expect(projectNeedsSwbImport(updated)).toBe(true);
  });

  it("marks standalone multi-layer SWB TIFF snapshots as needing Photoshop import", () => {
    const updated = mergeFolderImages(createEmptyProject(), [
      {
        imagePath: "/tmp/a.tiff",
        fileName: "a.tiff",
        width: 1920,
        height: 1080,
        fingerprint: "pixel-a",
        swbMetadata: {
          app: "Storyboard Workbench",
          format: "swb-tiff",
          version: 1,
          shotId: "shot-a",
          canvasWidth: 1920,
          canvasHeight: 1080,
          baseFingerprint: "pixel-a",
          updatedAt: "2026-05-30T00:00:00.000Z",
          layers: [
            { id: "layer-image", kind: "image" },
            { id: "layer-0001", kind: "paint" }
          ]
        } as any
      }
    ]);

    expect(updated.shots[0].swb).toMatchObject({
      status: "non-swb",
      statusMessage: "Import to convert this Photoshop layered TIFF into Storyboard Workbench Format"
    });
    expect(projectNeedsSwbImport(updated)).toBe(true);
  });

  it("does not create an empty Drawing layer for newly imported images", () => {
    const updated = addImportedImages(createEmptyProject(), [
      {
        imagePath: "/tmp/a.tiff",
        fileName: "a.tiff",
        width: 1920,
        height: 1080,
        fingerprint: "pixel-a"
      }
    ]);

    const shotId = updated.shots[0].id;
    expect(updated.shots[0].sketchLayers).toEqual([]);
    expect(updated.shots[0].activeLayerTarget).toBe("image");
    expect(updated.shots[0].activeLayerId).toBe("layer-image");
    expect(bitmapLayersForShot(updated.shots[0])).toEqual([
      {
        id: "layer-image",
        kind: "image",
        name: "Image",
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: "normal",
        order: 0,
        bitmapPath: `.storyboard-workbench/layers/${shotId}/layer-image.png`,
        width: 1920,
        height: 1080
      }
    ]);
  });

  it("defaults newly scanned images to the Image layer without an empty Drawing layer", () => {
    const updated = mergeFolderImages(createEmptyProject(), [
      {
        imagePath: "/tmp/a.png",
        fileName: "a.png",
        width: 1920,
        height: 1080,
        fingerprint: "pixel-a"
      }
    ]);

    const shotId = updated.shots[0].id;
    expect(updated.shots[0].sketchLayers).toEqual([]);
    expect(updated.shots[0].activeLayerTarget).toBe("image");
    expect(updated.shots[0].activeLayerId).toBe("layer-image");
    expect(bitmapLayersForShot(updated.shots[0])).toEqual([
      {
        id: "layer-image",
        kind: "image",
        name: "Image",
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: "normal",
        order: 0,
        bitmapPath: `.storyboard-workbench/layers/${shotId}/layer-image.png`,
        width: 1920,
        height: 1080
      }
    ]);
  });

  it("marks compatible external TIFF edits as needing import", () => {
    const project: Project = {
      ...makeProject(),
      shots: [
        {
          ...makeProject().shots[0],
          swb: {
            version: 1,
            status: "owned",
            canvasWidth: 1920,
            canvasHeight: 1080,
            baseFingerprint: "old-pixels"
          }
        }
      ],
      dialogues: []
    };

    const updated = mergeFolderImages(project, [
      {
        imagePath: "/tmp/a.png",
        fileName: "a.png",
        width: 1920,
        height: 1080,
        fingerprint: "new-pixels",
        swbMetadata: {
          app: "Storyboard Workbench",
          format: "swb-tiff",
          version: 1,
          shotId: "shot-a",
          canvasWidth: 1920,
          canvasHeight: 1080,
          baseFingerprint: "old-pixels",
          updatedAt: "2026-05-25T00:00:00.000Z",
          layers: []
        }
      }
    ]);

    expect(updated.shots[0].swb).toMatchObject({
      status: "compatible-external-edit",
      baseFingerprint: "old-pixels"
    });
    expect(projectNeedsSwbImport(updated)).toBe(true);
    expect(projectAcceptedExternalEdits(updated)).toBe(false);
  });

  it("merges external image changes without dropping unscanned shots", () => {
    const project: Project = {
      ...makeProject(),
      shots: [
        {
          ...makeProject().shots[0],
          swb: {
            version: 1,
            status: "owned",
            canvasWidth: 1920,
            canvasHeight: 1080,
            baseFingerprint: "old-pixels"
          }
        },
        ...makeProject().shots.slice(1)
      ]
    };
    const updated = mergeExternalImageChanges(project, [
      {
        imagePath: "/tmp/a.png",
        fileName: "a.png",
        width: 1920,
        height: 1080,
        fingerprint: "new-pixels",
        swbMetadata: {
          app: "Storyboard Workbench",
          format: "swb-tiff",
          version: 1,
          shotId: "shot-a",
          canvasWidth: 1920,
          canvasHeight: 1080,
          baseFingerprint: "old-pixels",
          updatedAt: "2026-05-25T00:00:00.000Z",
          layers: []
        }
      }
    ]);

    expect(updated.shots).toHaveLength(project.shots.length);
    expect(updated.shots[0].swb?.status).toBe("compatible-external-edit");
  });

  it("keeps parked external edits importable instead of hiding the warning state", () => {
    const project: Project = {
      ...makeProject(),
      parkedShots: [
        {
          ...makeProject().shots[1],
          id: "shot-parked",
          imagePath: "/tmp/parked.tiff",
          fileName: "parked.tiff",
          order: 0,
          swb: {
            version: 1,
            status: "owned",
            canvasWidth: 1920,
            canvasHeight: 1080,
            baseFingerprint: "old-pixels"
          }
        }
      ]
    };

    const updated = mergeExternalImageChanges(project, [
      {
        imagePath: "/tmp/parked.tiff",
        fileName: "parked.tiff",
        width: 1920,
        height: 1080,
        fingerprint: "new-pixels",
        swbMetadata: {
          app: "Storyboard Workbench",
          format: "swb-tiff",
          version: 1,
          shotId: "shot-parked",
          canvasWidth: 1920,
          canvasHeight: 1080,
          baseFingerprint: "old-pixels",
          updatedAt: "2026-05-25T00:00:00.000Z",
          layers: []
        }
      }
    ]);

    expect(updated.parkedShots?.[0].swb?.status).toBe("compatible-external-edit");
    expect(projectNeedsSwbImport(updated)).toBe(true);
    expect(projectHasSwbWarning(updated)).toBe(true);
  });

  it("does not let TIFF metadata override the project fingerprint baseline", () => {
    const project: Project = {
      ...makeProject(),
      shots: [
        {
          ...makeProject().shots[0],
          swb: {
            version: 1,
            status: "owned",
            canvasWidth: 1920,
            canvasHeight: 1080,
            baseFingerprint: "old-json-pixels"
          }
        }
      ],
      dialogues: []
    };

    const updated = mergeFolderImages(project, [
      {
        imagePath: "/tmp/a.png",
        fileName: "a.png",
        width: 1920,
        height: 1080,
        fingerprint: "saved-tiff-pixels",
        swbMetadata: {
          app: "Storyboard Workbench",
          format: "swb-tiff",
          version: 1,
          shotId: "shot-a",
          canvasWidth: 1920,
          canvasHeight: 1080,
          baseFingerprint: "saved-tiff-pixels",
          updatedAt: "2026-05-25T00:00:00.000Z",
          layers: []
        }
      }
    ]);

    expect(updated.shots[0].swb).toMatchObject({
      status: "compatible-external-edit",
      baseFingerprint: "old-json-pixels"
    });
    expect(projectNeedsSwbImport(updated)).toBe(true);
  });

  it("keeps owned status when project fingerprint is newer than stale TIFF metadata", () => {
    const project: Project = {
      ...makeProject(),
      shots: [
        {
          ...makeProject().shots[0],
          swb: {
            version: 1,
            status: "owned",
            canvasWidth: 1920,
            canvasHeight: 1080,
            baseFingerprint: "imported-pixels"
          }
        }
      ],
      dialogues: []
    };

    const updated = mergeExternalImageChanges(project, [
      {
        imagePath: "/tmp/a.png",
        fileName: "a.png",
        width: 1920,
        height: 1080,
        fingerprint: "imported-pixels",
        swbMetadata: {
          app: "Storyboard Workbench",
          format: "swb-tiff",
          version: 1,
          shotId: "shot-a",
          canvasWidth: 1920,
          canvasHeight: 1080,
          baseFingerprint: "old-xmp-pixels",
          updatedAt: "2026-05-25T00:00:00.000Z",
          layers: []
        }
      }
    ]);

    expect(updated.shots[0].swb).toMatchObject({
      status: "owned",
      baseFingerprint: "imported-pixels"
    });
    expect(projectNeedsSwbImport(updated)).toBe(false);
    expect(projectHasSwbWarning(updated)).toBe(false);
  });

  it("repairs copied SWB TIFFs whose embedded shot id still points at the source shot", () => {
    const project: Project = {
      ...makeProject(),
      shots: [
        {
          ...makeProject().shots[0],
          id: "shot-copy",
          swb: {
            version: 1,
            status: "incompatible-external-edit",
            canvasWidth: 1920,
            canvasHeight: 1080,
            baseFingerprint: "copied-pixels",
            statusMessage: "SWB shot id in TIFF does not match project metadata"
          }
        }
      ],
      dialogues: []
    };

    const updated = mergeExternalImageChanges(project, [
      {
        imagePath: "/tmp/a.png",
        fileName: "a.png",
        width: 1920,
        height: 1080,
        fingerprint: "copied-pixels",
        swbMetadata: {
          app: "Storyboard Workbench",
          format: "swb-tiff",
          version: 1,
          shotId: "source-shot",
          canvasWidth: 1920,
          canvasHeight: 1080,
          baseFingerprint: "copied-pixels",
          updatedAt: "2026-05-25T00:00:00.000Z",
          layers: []
        }
      }
    ]);

    expect(updated.shots[0].swb).toMatchObject({
      status: "owned",
      baseFingerprint: "copied-pixels",
      statusMessage: undefined
    });
    expect(projectNeedsSwbImport(updated)).toBe(false);
    expect(projectHasSwbWarning(updated)).toBe(false);
  });

  it("keeps parked shots owned when project fingerprint is newer than stale TIFF metadata", () => {
    const project: Project = {
      ...makeProject(),
      parkedShots: [
        {
          ...makeProject().shots[1],
          id: "shot-parked",
          imagePath: "/tmp/parked.tiff",
          fileName: "parked.tiff",
          order: 0,
          swb: {
            version: 1,
            status: "owned",
            canvasWidth: 1920,
            canvasHeight: 1080,
            baseFingerprint: "imported-pixels"
          }
        }
      ]
    };

    const updated = mergeExternalImageChanges(project, [
      {
        imagePath: "/tmp/parked.tiff",
        fileName: "parked.tiff",
        width: 1920,
        height: 1080,
        fingerprint: "imported-pixels",
        swbMetadata: {
          app: "Storyboard Workbench",
          format: "swb-tiff",
          version: 1,
          shotId: "shot-parked",
          canvasWidth: 1920,
          canvasHeight: 1080,
          baseFingerprint: "old-xmp-pixels",
          updatedAt: "2026-05-25T00:00:00.000Z",
          layers: []
        }
      }
    ]);

    expect(updated.parkedShots?.[0].swb).toMatchObject({
      status: "owned",
      baseFingerprint: "imported-pixels"
    });
    expect(projectNeedsSwbImport(updated)).toBe(false);
    expect(projectHasSwbWarning(updated)).toBe(false);
  });

  it("keeps owned status when SWB metadata is missing but pixels match the project baseline", () => {
    const project: Project = {
      ...makeProject(),
      shots: [
        {
          ...makeProject().shots[0],
          swb: {
            version: 1,
            status: "owned",
            canvasWidth: 1920,
            canvasHeight: 1080,
            baseFingerprint: "same-pixels"
          }
        }
      ],
      dialogues: []
    };

    const updated = mergeFolderImages(project, [
      {
        imagePath: "/tmp/a.png",
        fileName: "a.png",
        width: 1920,
        height: 1080,
        fingerprint: "same-pixels"
      }
    ]);

    expect(updated.shots[0].swb?.status).toBe("owned");
    expect(projectNeedsSwbImport(updated)).toBe(false);
  });

  it("marks changed TIFF dimensions as incompatible external edits", () => {
    const project: Project = {
      ...makeProject(),
      shots: [
        {
          ...makeProject().shots[0],
          swb: {
            version: 1,
            status: "owned",
            canvasWidth: 1920,
            canvasHeight: 1080,
            baseFingerprint: "old-pixels"
          }
        }
      ],
      dialogues: []
    };

    const updated = mergeFolderImages(project, [
      {
        imagePath: "/tmp/a.png",
        fileName: "a.png",
        width: 1280,
        height: 720,
        fingerprint: "new-pixels",
        swbMetadata: {
          app: "Storyboard Workbench",
          format: "swb-tiff",
          version: 1,
          shotId: "shot-a",
          canvasWidth: 1920,
          canvasHeight: 1080,
          baseFingerprint: "old-pixels",
          updatedAt: "2026-05-25T00:00:00.000Z",
          layers: []
        }
      }
    ]);

    expect(updated.shots[0].swb).toMatchObject({
      status: "incompatible-external-edit"
    });
    expect(projectNeedsSwbImport(updated)).toBe(true);
  });

  it("inserts a generated shot after the selected shot", () => {
    const project = makeProject();

    const updated = addGeneratedShot(
      project,
      {
        imagePath: "/tmp/new_shot.tiff",
        fileName: "new_shot.tiff"
      },
      "shot-a"
    );

    expect(updated.shots.map((shot) => [shot.fileName, shot.order])).toEqual([
      ["a.png", 0],
      ["new_shot.tiff", 1],
      ["b.png", 2],
      ["c.png", 3]
    ]);
  });

  it("defaults generated blank shots to a white Image layer with a selected transparent Drawing layer", () => {
    const updated = addGeneratedShot(createEmptyProject(), {
      imagePath: "/tmp/new_shot.tiff",
      fileName: "new_shot.tiff",
      width: 1920,
      height: 1080,
      fingerprint: "blank-white"
    });
    const shot = updated.shots[0];

    expect(shot.activeLayerId).toBe("layer-drawing");
    expect(bitmapLayersForShot(shot)).toEqual([
      {
        id: "layer-image",
        kind: "image",
        name: "Image",
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: "normal",
        order: 0,
        bitmapPath: `.storyboard-workbench/layers/${shot.id}/layer-image.png`,
        width: 1920,
        height: 1080
      },
      {
        id: "layer-drawing",
        kind: "paint",
        name: "Drawing",
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: "normal",
        order: 1,
        bitmapPath: `.storyboard-workbench/layers/${shot.id}/layer-drawing.png`,
        width: 1920,
        height: 1080
      }
    ]);
  });

  it("plans stable ordered filenames without stacking numeric prefixes", () => {
    const project: Project = {
      ...makeProject(),
      naming: {
        sceneCode: "sc01",
        artistName: "artist",
        version: "v001"
      },
      shots: [
        {
          id: "shot-a",
          imagePath: "/tmp/001_alpha.png",
          fileName: "001_alpha.png",
          order: 1,
          sketchLayers: []
        },
        {
          id: "shot-b",
          imagePath: "/tmp/beta.tiff",
          fileName: "beta.tiff",
          order: 0,
          sketchLayers: []
        }
      ],
      dialogues: []
    };

    const plan = createRenamePlan(project);

    expect(plan.map((item) => [item.shotId, item.finalPath, item.finalFileName])).toEqual([
      ["shot-b", "/tmp/Test_Project_sc01_stb_artist_v001_0010.tiff", "Test_Project_sc01_stb_artist_v001_0010.tiff"],
      ["shot-a", "/tmp/Test_Project_sc01_stb_artist_v001_0020.png", "Test_Project_sc01_stb_artist_v001_0020.png"]
    ]);
  });

  it("uses storyboard naming metadata for Save filenames", () => {
    const project: Project = {
      ...makeProject(),
      name: "项目",
      naming: {
        sceneCode: "场01",
        artistName: "artist",
        version: "v001"
      }
    };

    const plan = createRenamePlan(project);

    expect(plan.map((item) => item.finalFileName)).toEqual([
      "项目_场01_stb_artist_v001_0010.png",
      "项目_场01_stb_artist_v001_0020.png",
      "项目_场01_stb_artist_v001_0030.png"
    ]);
  });

  it("uses default optional naming fields when requested", () => {
    const project: Project = {
      ...makeProject(),
      name: "Board",
      naming: {
        sceneCode: "",
        artistName: "",
        version: ""
      }
    };

    const plan = createRenamePlan(project, { allowDefaultNamingFields: true });

    expect(plan[0].finalFileName).toBe("Board_scene_stb_artist_v001_0010.png");
  });

  it("sanitizes naming fields and normalizes numeric versions", () => {
    const project: Project = {
      ...makeProject(),
      name: "Board / Main",
      naming: {
        sceneCode: "sc:01",
        artistName: "a/b",
        version: "001"
      }
    };

    const plan = createRenamePlan(project);

    expect(plan[0].finalFileName).toBe("Board_Main_sc_01_stb_a_b_v001_0010.png");
  });

  it("reports rename preflight conflicts for existing final and temporary paths", () => {
    const plan = createRenamePlan(makeProject());

    const result = validateRenamePlan(
      plan,
      new Set(["/tmp/Test_Project_stb_0010.png", "/tmp/.storyboard-renaming-shot-b.png"])
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([
      {
        path: "/tmp/Test_Project_stb_0010.png",
        reason: "final-exists",
        message: "Target file already exists: /tmp/Test_Project_stb_0010.png"
      },
      {
        path: "/tmp/.storyboard-renaming-shot-b.png",
        reason: "temporary-exists",
        message: "Temporary rename file already exists: /tmp/.storyboard-renaming-shot-b.png"
      }
    ]);
  });

  it("allows rename targets that are part of the same rename plan", () => {
    const project: Project = {
      ...makeProject(),
      shots: [
        {
          id: "shot-a",
          imagePath: "/tmp/001_a.png",
          fileName: "001_a.png",
          sourceFileName: "a.png",
          order: 0,
          sketchLayers: []
        },
        {
          id: "shot-b",
          imagePath: "/tmp/002_b.png",
          fileName: "002_b.png",
          sourceFileName: "b.png",
          order: 1,
          sketchLayers: []
        }
      ],
      dialogues: []
    };
    const plan = createRenamePlan(project);

    const result = validateRenamePlan(plan, new Set(["/tmp/001_a.png", "/tmp/002_b.png"]));

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("skips file names reserved by parked shots", () => {
    const project: Project = {
      ...makeProject(),
      name: "Board",
      shots: Array.from({ length: 3 }, (_, index) => ({
        id: `shot-${index}`,
        imagePath: `/tmp/current-${index}.png`,
        fileName: `current-${index}.png`,
        sourceFileName: `current-${index}.png`,
        order: index,
        sketchLayers: []
      })),
      parkedShots: [
        {
          id: "parked-shot",
          imagePath: "/tmp/Board_stb_0020.png",
          fileName: "Board_stb_0020.png",
          sourceFileName: "Board_stb_0020.png",
          order: 0,
          sketchLayers: []
        }
      ],
      dialogues: []
    };

    const plan = createRenamePlan(project);

    expect(plan.map((item) => item.finalFileName)).toEqual([
      "Board_stb_0010.png",
      "Board_stb_0030.png",
      "Board_stb_0040.png"
    ]);
  });
});
