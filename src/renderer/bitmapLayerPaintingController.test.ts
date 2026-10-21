import { afterEach, describe, expect, it, vi } from "vitest";
import type { BitmapLayer, Project, Shot, SketchStroke } from "../shared/types";
import { createBitmapLayerWriteQueue } from "./bitmapLayerWriteQueue";
import {
  sourceDataUrlForBitmapLayer,
  useBitmapLayerPaintingController
} from "./bitmapLayerPaintingController";

// These canvas/queue unit fixtures do not certify owner lifecycle; the
// normalSave* suites inject the real owner capabilities across that seam.
const fixtureCompletion = () => Object.assign(async () => undefined, { failed: () => undefined });

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
  afterEach(() => vi.unstubAllGlobals());

  it.each(["brush", "eraser"] as const)(
    "persists each queued stroke once when a pending %s write is delayed",
    async (firstTool) => {
      // Operation ledger only, not a pixel renderer. Exercise the real controller,
      // write queue, bitmap canvas helper and stroke drawing code together.
      class LedgerImage {
        onload?: () => void;
        operations: string[] = [];
        set src(value: string) {
          this.operations = JSON.parse(value);
          this.onload?.();
        }
      }
      vi.stubGlobal("Image", LedgerImage);
      vi.stubGlobal("document", {
        createElement: () => {
          let operations: string[] = [];
          const context = {
            globalAlpha: 1,
            globalCompositeOperation: "source-over",
            strokeStyle: "",
            clearRect: () => { operations = []; },
            drawImage: (image: LedgerImage) => { operations = [...image.operations]; },
            save: () => undefined,
            restore: () => undefined,
            beginPath: () => undefined,
            moveTo: () => undefined,
            lineTo: () => undefined,
            stroke: () => {
              operations.push(`${context.strokeStyle}:${context.globalCompositeOperation}:${context.globalAlpha}`);
            }
          };
          return {
            width: 0, height: 0,
            getContext: () => context,
            toDataURL: () => JSON.stringify(operations)
          };
        }
      });
      let stored = "[]";
      let releaseWrite!: () => void;
      let signalWriteStarted!: () => void;
      const writeGate = new Promise<void>((resolve) => { releaseWrite = resolve; });
      const writeStarted = new Promise<void>((resolve) => { signalWriteStarted = resolve; });
      const writes: string[] = [];
      const storyboardApi = {
        ...api(),
        readLayerPng: vi.fn(async () => stored),
        writeLayerPng: vi.fn(async ({ dataUrl }: { dataUrl: string }) => {
          if (writes.length === 0) {
            signalWriteStarted();
            await writeGate;
          }
          stored = dataUrl;
          writes.push(dataUrl);
        })
      } as unknown as Window["storyboard"];
      const currentShot = shot();
      const queue = createBitmapLayerWriteQueue();
      const recordUndoEntry = vi.fn();
      const markShotsDirty = vi.fn();
      const controller = useBitmapLayerPaintingController({
      captureWorkspace: () => () => true,
      captureEffectCompletion: fixtureCompletion,
        api: storyboardApi,
        projectRef: { current: {
          id: "project", name: "Project", shots: [currentShot], dialogues: [],
          createdAt: "2026-01-01", updatedAt: "2026-01-01"
        } },
        folderPath: "/scene",
        bitmapLayerWriteQueueRef: { current: queue },
        createHistoryEntryFromLayerAssets: (assets) => assets,
        recordUndoEntry,
        markShotsDirty,
        updateProject: vi.fn()
      });
      const first: SketchStroke = {
        id: "first", tool: firstTool, color: "#111111", size: 4,
        opacity: 0.5, points: [1, 2, 3, 4]
      };
      const second: SketchStroke = { ...first, id: "second", tool: "brush", color: "#222222" };
      const third: SketchStroke = { ...second, id: "third", color: "#333333" };
      const firstWrite = controller.handleBitmapStroke(currentShot, "layer-image", first);
      await writeStarted;
      const secondWrite = controller.handleBitmapStroke(currentShot, "layer-image", second, undefined, [first]);
      const thirdWrite = controller.handleBitmapStroke(currentShot, "layer-image", third, undefined, [first, second]);
      try {
        expect(storyboardApi.readLayerPng).toHaveBeenCalledTimes(1);
        expect(stored).toBe("[]");
        expect(recordUndoEntry).not.toHaveBeenCalled();
      } finally {
        releaseWrite();
      }
      await Promise.all([firstWrite, secondWrite, thirdWrite]);
      await queue.drain();
      const firstOperation = `#111111:${firstTool === "eraser" ? "destination-out" : "source-over"}:0.5`;
      expect(writes.map((value) => JSON.parse(value))).toEqual([
        [firstOperation],
        [firstOperation, "#222222:source-over:0.5"],
        [firstOperation, "#222222:source-over:0.5", "#333333:source-over:0.5"]
      ]);
      expect(stored).toBe(writes[2]);
      expect(storyboardApi.readLayerPng).toHaveBeenCalledTimes(3);
      expect(recordUndoEntry.mock.calls.map(([assets]) => assets[0].dataUrl)).toEqual([
        "[]", writes[0], writes[1]
      ]);
      expect(markShotsDirty).toHaveBeenCalledTimes(3);
    }
  );

  it("uses the existing layer PNG as the paint source when it is available", async () => {
    const storyboardApi = api({ layerDataUrl: "data:image/png;base64,layer" });
    const createBlankLayerDataUrl = vi.fn().mockResolvedValue("blank");

    await expect(
      sourceDataUrlForBitmapLayer({
        api: storyboardApi,
        folderPath: "/scene",
        shot: shot(),
        layer: imageLayer(),
        createBlankLayerDataUrl
      })
    ).resolves.toBe("data:image/png;base64,layer");
    expect(storyboardApi.readLayerPng).toHaveBeenCalledTimes(1);
    expect(createBlankLayerDataUrl).not.toHaveBeenCalled();
  });

  it("reuses a preloaded missing layer result without issuing a second read", async () => {
    const storyboardApi = api();
    const createBlankLayerDataUrl = vi.fn().mockResolvedValue("blank");

    await expect(
      sourceDataUrlForBitmapLayer({
        api: storyboardApi,
        folderPath: "/scene",
        shot: shot(),
        layer: imageLayer({ kind: "paint" }),
        createBlankLayerDataUrl,
        preloadedLayer: { loaded: true, dataUrl: undefined }
      })
    ).resolves.toBe("blank");

    expect(storyboardApi.readLayerPng).not.toHaveBeenCalled();
    expect(createBlankLayerDataUrl).toHaveBeenCalledTimes(1);
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

  it("propagates layer read failures instead of treating existing pixels as missing", async () => {
    const readError = new Error("layer read failed");
    const storyboardApi = api();
    vi.mocked(storyboardApi.readLayerPng).mockRejectedValue(readError);
    const createBlankLayerDataUrl = vi.fn().mockResolvedValue("blank");

    await expect(
      sourceDataUrlForBitmapLayer({
        api: storyboardApi,
        folderPath: "/scene",
        shot: shot(),
        layer: imageLayer({ kind: "paint" }),
        createBlankLayerDataUrl
      })
    ).rejects.toBe(readError);

    expect(createBlankLayerDataUrl).not.toHaveBeenCalled();
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
      captureWorkspace: () => () => true,
      captureEffectCompletion: fixtureCompletion,
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
      createHistoryEntryFromLayerAssets: vi.fn(() => "history"),
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
    expect(storyboardApi.readLayerPng).toHaveBeenCalledTimes(1);
    expect(markShotsDirty).toHaveBeenCalledWith(["shot-1"]);
    expect(updateProject).toHaveBeenCalledWith(expect.any(Function), false, false);
  });

  it("does not blur locked layers or a zero radius", async () => {
    const lockedLayer = imageLayer({ locked: true });
    const currentShot = shot({ layers: [lockedLayer] });
    const blurBitmapLayer = vi.fn();
    const controller = useBitmapLayerPaintingController({
      captureWorkspace: () => () => true,
      captureEffectCompletion: fixtureCompletion,
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
      createHistoryEntryFromLayerAssets: vi.fn(),
      recordUndoEntry: vi.fn(),
      markShotsDirty: vi.fn(),
      updateProject: vi.fn(),
      blurBitmapLayer
    });

    await expect(controller.handleBitmapBlur(currentShot, lockedLayer.id, 8)).resolves.toBeUndefined();
    await expect(controller.handleBitmapBlur(shot(), "layer-image", 0)).resolves.toBeUndefined();
    expect(blurBitmapLayer).not.toHaveBeenCalled();
  });

  it("aborts bitmap edits when the undo source cannot be read", async () => {
    const readError = new Error("layer read failed");
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
      ...api(),
      readLayerPng: vi.fn().mockRejectedValue(readError),
      writeLayerPng: vi.fn()
    } as unknown as Window["storyboard"];
    const createHistoryEntryFromLayerAssets = vi.fn();
    const recordUndoEntry = vi.fn();
    const markShotsDirty = vi.fn();
    const updateProject = vi.fn();
    const controller = useBitmapLayerPaintingController({
      captureWorkspace: () => () => true,
      captureEffectCompletion: fixtureCompletion,
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
      createHistoryEntryFromLayerAssets,
      recordUndoEntry,
      markShotsDirty,
      updateProject
    });

    await expect(
      controller.handleBitmapSelectionTransform(
        currentShot,
        "layer-image",
        "data:image/png;base64,transformed"
      )
    ).rejects.toBe(readError);

    expect(createHistoryEntryFromLayerAssets).not.toHaveBeenCalled();
    expect(storyboardApi.writeLayerPng).not.toHaveBeenCalled();
    expect(recordUndoEntry).not.toHaveBeenCalled();
    expect(markShotsDirty).not.toHaveBeenCalled();
    expect(updateProject).not.toHaveBeenCalled();
  });
});
