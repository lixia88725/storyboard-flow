import { describe, expect, it, vi } from "vitest";
import type { BitmapLayer, Project, Shot } from "../shared/types";
import {
  sourceDataUrlForBitmapLayer,
  useBitmapLayerPaintingController
} from "./bitmapLayerPaintingController";

const imageLayer = (overrides: Partial<BitmapLayer> = {}): BitmapLayer => ({
  id: "layer-image",
  name: "Image",
  kind: "image",
  bitmapPath: ".storyboard-workbench/layers/shot-1/layer-image.png",
  visible: true,
  locked: false,
  opacity: 1,
  blendMode: "normal",
  order: 0,
  width: 100,
  height: 80,
  ...overrides
});

const shot = (overrides: Partial<Shot> = {}): Shot => ({
  id: "shot-1",
  fileName: "shot.tiff",
  imagePath: "/scene/shot.tiff",
  previewPath: "/scene/.storyboard-workbench/previews/shot.png",
  order: 10,
  layers: [imageLayer()],
  ...overrides
});

const api = ({
  layerDataUrl
}: {
  layerDataUrl?: string;
} = {}): Window["storyboard"] =>
  ({
    readLayerPng: vi.fn().mockResolvedValue(layerDataUrl),
    assetUrl: vi.fn((path: string) => `asset://${path}`)
  }) as unknown as Window["storyboard"];

describe("bitmapLayerPaintingController", () => {
  it("uses the existing layer PNG as the paint source when it is available", async () => {
    const storyboardApi = api({ layerDataUrl: "data:image/png;base64,layer" });

    await expect(
      sourceDataUrlForBitmapLayer({
        api: storyboardApi,
        folderPath: "/scene",
        shot: shot(),
        layer: imageLayer(),
        createBlankLayerDataUrl: vi.fn().mockResolvedValue("blank")
      })
    ).resolves.toBe("data:image/png;base64,layer");
  });

  it("uses a blank source for cleared image layers and paint layers", async () => {
    const storyboardApi = api();
    const createBlankLayerDataUrl = vi.fn().mockResolvedValue("blank");

    await expect(
      sourceDataUrlForBitmapLayer({
        api: storyboardApi,
        folderPath: "/scene",
        shot: shot(),
        layer: imageLayer({ cleared: true }),
        createBlankLayerDataUrl
      })
    ).resolves.toBe("blank");

    await expect(
      sourceDataUrlForBitmapLayer({
        api: storyboardApi,
        folderPath: "/scene",
        shot: shot(),
        layer: imageLayer({ kind: "paint", cleared: false }),
        createBlankLayerDataUrl
      })
    ).resolves.toBe("blank");
  });

  it("falls back to the shot preview asset for uncleared image layers", async () => {
    const storyboardApi = api();

    await expect(
      sourceDataUrlForBitmapLayer({
        api: storyboardApi,
        folderPath: "/scene",
        shot: shot(),
        layer: imageLayer(),
        createBlankLayerDataUrl: vi.fn().mockResolvedValue("blank")
      })
    ).resolves.toBe("asset:///scene/.storyboard-workbench/previews/shot.png");
  });

  it("records history and writes the blurred bitmap through the layer queue", async () => {
    vi.stubGlobal("document", {
      createElement: vi.fn(() => ({
        width: 0,
        height: 0,
        toDataURL: vi.fn(() => "blank")
      }))
    });
    const currentShot = shot();
    const project: Project = {
      id: "project",
      name: "Project",
      shots: [currentShot],
      dialogues: [],
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01"
    };
    const storyboardApi = {
      ...api({ layerDataUrl: "source-layer" }),
      writeLayerPng: vi.fn().mockResolvedValue(undefined)
    } as unknown as Window["storyboard"];
    const blurBitmapLayer = vi.fn().mockResolvedValue("blurred-layer");
    const recordUndoEntry = vi.fn();
    const markShotsDirty = vi.fn();
    const updateProject = vi.fn();
    const controller = useBitmapLayerPaintingController({
      api: storyboardApi,
      projectRef: { current: project },
      folderPath: "/scene",
      bitmapLayerWriteQueueRef: {
        current: {
          enqueue: async (_bitmapPath, task) => task(),
          drain: async () => undefined,
          runExclusive: async (task) => task()
        }
      },
      createHistoryEntry: vi.fn().mockResolvedValue("history"),
      recordUndoEntry,
      markShotsDirty,
      updateProject,
      blurBitmapLayer
    });

    const selectionPoints = [
      { x: 10, y: 10 },
      { x: 60, y: 10 },
      { x: 60, y: 50 }
    ];
    await expect(
      controller.handleBitmapBlur(currentShot, "layer-image", 12.4, selectionPoints)
    ).resolves.toBe("blurred-layer");

    expect(blurBitmapLayer).toHaveBeenCalledWith(
      "source-layer",
      imageLayer(),
      12,
      selectionPoints
    );
    expect(storyboardApi.writeLayerPng).toHaveBeenCalledWith({
      folderPath: "/scene",
      bitmapPath: imageLayer().bitmapPath,
      dataUrl: "blurred-layer"
    });
    expect(recordUndoEntry).toHaveBeenCalledWith("history");
    expect(markShotsDirty).toHaveBeenCalledWith(["shot-1"]);
    expect(updateProject).toHaveBeenCalledWith(expect.any(Function), false, false);
  });

  it("does not blur locked layers or a zero radius", async () => {
    const lockedLayer = imageLayer({ locked: true });
    const currentShot = shot({ layers: [lockedLayer] });
    const blurBitmapLayer = vi.fn();
    const controller = useBitmapLayerPaintingController({
      api: api(),
      projectRef: {
        current: {
          id: "project",
          name: "Project",
          shots: [currentShot],
          dialogues: [],
          createdAt: "2026-01-01",
          updatedAt: "2026-01-01"
        }
      },
      folderPath: "/scene",
      bitmapLayerWriteQueueRef: {
        current: {
          enqueue: async (_bitmapPath, task) => task(),
          drain: async () => undefined,
          runExclusive: async (task) => task()
        }
      },
      createHistoryEntry: vi.fn(),
      recordUndoEntry: vi.fn(),
      markShotsDirty: vi.fn(),
      updateProject: vi.fn(),
      blurBitmapLayer
    });

    await expect(controller.handleBitmapBlur(currentShot, lockedLayer.id, 8)).resolves.toBeUndefined();
    await expect(controller.handleBitmapBlur(shot(), "layer-image", 0)).resolves.toBeUndefined();
    expect(blurBitmapLayer).not.toHaveBeenCalled();
  });
});
