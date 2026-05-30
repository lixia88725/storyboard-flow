import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { applyBitmapLayerOpacity, flattenBitmapLayerBuffersToTiff, shouldEnsureLayerAssetsForShot } from "./bitmapLayers.js";
import { bitmapLayersForShot } from "./bitmapLayerOrdering.js";

describe("applyBitmapLayerOpacity", () => {
  it("normalizes bitmap layers for Electron save and export paths", () => {
    const layers = bitmapLayersForShot({
      layers: [
        {
          id: "paint-top",
          kind: "paint",
          name: "Top",
          visible: undefined,
          locked: undefined,
          opacity: undefined,
          blendMode: undefined,
          order: 2,
          bitmapPath: ".storyboard-workbench/layers/shot-a/paint-top.png",
          width: 320,
          height: 180
        },
        {
          id: "layer-image",
          kind: "image",
          name: "Image",
          visible: false,
          locked: true,
          opacity: 0.5,
          blendMode: "multiply",
          order: 99,
          bitmapPath: ".storyboard-workbench/layers/shot-a/layer-image.png",
          width: 320,
          height: 180
        },
        {
          id: "paint-bottom",
          kind: "paint",
          name: "Bottom",
          visible: true,
          locked: false,
          opacity: 0.75,
          blendMode: "screen",
          order: 1,
          bitmapPath: ".storyboard-workbench/layers/shot-a/paint-bottom.png",
          width: 320,
          height: 180
        }
      ]
    });

    expect(layers.map((layer) => [layer.id, layer.order])).toEqual([
      ["layer-image", 0],
      ["paint-bottom", 1],
      ["paint-top", 2]
    ]);
    expect(layers[2]).toMatchObject({
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: "normal"
    });
  });

  it("skips external shot layer assets only when external shots are excluded", () => {
    expect(shouldEnsureLayerAssetsForShot({ swb: { status: "owned" } })).toBe(true);
    expect(shouldEnsureLayerAssetsForShot({ swb: { status: "non-swb" } })).toBe(true);
    expect(shouldEnsureLayerAssetsForShot({ swb: { status: "compatible-external-edit" } })).toBe(true);
    expect(shouldEnsureLayerAssetsForShot({ swb: { status: "incompatible-external-edit" } })).toBe(true);
    expect(shouldEnsureLayerAssetsForShot({})).toBe(true);
    expect(
      shouldEnsureLayerAssetsForShot({ swb: { status: "owned" } }, { includeExternalShots: false })
    ).toBe(true);
    expect(
      shouldEnsureLayerAssetsForShot({ swb: { status: "non-swb" } }, { includeExternalShots: false })
    ).toBe(false);
    expect(shouldEnsureLayerAssetsForShot({}, { includeExternalShots: false })).toBe(false);
  });

  it("multiplies the bitmap alpha by the layer opacity", async () => {
    const source = await sharp({
      create: {
        width: 1,
        height: 1,
        channels: 4,
        background: { r: 240, g: 90, b: 40, alpha: 1 }
      }
    })
      .png()
      .toBuffer();

    const faded = await applyBitmapLayerOpacity(source, 0.35);
    const pixel = await sharp(faded).raw().toBuffer();

    expect(Array.from(pixel)).toEqual([240, 90, 40, 89]);
  });

  it("flattens all visible bitmap layer buffers in order", async () => {
    const bottomRed = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 1 }
      }
    })
      .png()
      .toBuffer();
    const topBlue = await sharp({
      create: {
        width: 1,
        height: 1,
        channels: 4,
        background: { r: 0, g: 0, b: 255, alpha: 1 }
      }
    })
      .extend({ right: 1, bottom: 1, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();

    const flattened = await flattenBitmapLayerBuffersToTiff(2, 2, [
      { input: bottomRed, blend: "over", opacity: 1 },
      { input: topBlue, blend: "over", opacity: 1 }
    ]);
    const pixels = await sharp(flattened).removeAlpha().raw().toBuffer();

    expect(Array.from(pixels)).toEqual([
      0, 0, 255,
      255, 0, 0,
      255, 0, 0,
      255, 0, 0
    ]);
  });
});
