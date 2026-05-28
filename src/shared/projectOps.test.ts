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
  deleteBitmapLayer,
  flattenSketchLayers,
  getNextStoryboardIndex,
  moveBitmapLayer,
  removeSketchLayer,
  reorderSketchLayer,
  moveSketchLayer,
  selectBitmapLayer,
  selectSketchLayer,
  updateBitmapLayer,
  updateSketchLayer,
  updateShotBaseVisibility,
  validateRenamePlan,
  mergeFolderImages,
  moveDialogueToShot,
  projectAcceptedExternalEdits,
  projectNeedsSwbImport,
  removeDialogue,
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
    expect(deleted.shots[0].activeLayerId).toBe("paint-1");
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

  it("accepts compatible external TIFF edits as a new base", () => {
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
      status: "owned",
      baseFingerprint: "new-pixels"
    });
    expect(projectAcceptedExternalEdits(updated)).toBe(true);
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
});
