import { describe, expect, it } from "vitest";
import type { BitmapLayer, Shot } from "../shared/types";
import { timelineLayerPreviewItems } from "./Timeline";

const layer = (overrides: Partial<BitmapLayer>): BitmapLayer => ({
  id: "layer-image",
  kind: "image",
  name: "Image",
  visible: true,
  locked: false,
  opacity: 1,
  blendMode: "normal",
  order: 0,
  bitmapPath: ".storyboard-workbench/layers/shot-1/layer-image.png",
  width: 1920,
  height: 1080,
  ...overrides
});

const shot = (layers: BitmapLayer[]): Shot => ({
  id: "shot-1",
  imagePath: "/scene/shot.tiff",
  previewPath: "/scene/preview.png",
  fileName: "shot.tiff",
  order: 1,
  layers
});

describe("Timeline", () => {
  it("builds thumbnail preview items from visible bitmap layers", () => {
    const imageLayer = layer({
      id: "image",
      kind: "image",
      order: 0,
      bitmapPath: ".storyboard-workbench/layers/shot-1/image.png"
    });
    const paintLayer = layer({
      id: "paint",
      kind: "paint",
      order: 1,
      bitmapPath: ".storyboard-workbench/layers/shot-1/paint.png",
      opacity: 0.75,
      blendMode: "multiply"
    });

    expect(
      timelineLayerPreviewItems(shot([imageLayer, paintLayer]), {
        fallbackSrc: "asset://preview.png",
        layerDataUrls: { paint: "data:image/png;base64,paint" }
      })
    ).toEqual([
      {
        id: "image",
        mixBlendMode: "normal",
        opacity: 1,
        src: "asset://preview.png"
      },
      {
        id: "paint",
        mixBlendMode: "multiply",
        opacity: 0.75,
        src: "data:image/png;base64,paint"
      }
    ]);
  });

  it("omits hidden layers and cleared paint layers from thumbnail previews", () => {
    expect(
      timelineLayerPreviewItems(
        shot([
          layer({
            id: "hidden",
            kind: "image",
            visible: false,
            bitmapPath: ".storyboard-workbench/layers/shot-1/hidden.png"
          }),
          layer({
            id: "cleared-paint",
            kind: "paint",
            cleared: true,
            bitmapPath: ".storyboard-workbench/layers/shot-1/cleared-paint.png"
          })
        ]),
        {
          fallbackSrc: "asset://preview.png",
          layerDataUrls: {}
        }
      )
    ).toEqual([]);
  });
});
