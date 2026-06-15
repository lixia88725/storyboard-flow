import { describe, expect, it, vi } from "vitest";
import type { BitmapLayer, Shot } from "../shared/types";
import { sourceDataUrlForBitmapLayer } from "./bitmapLayerPaintingController";

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
});
