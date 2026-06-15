import { afterEach, describe, expect, it, vi } from "vitest";
import type { BitmapLayer, SketchStroke } from "../shared/types";
import {
  createTransparentLayerDataUrl,
  drawStrokeOnBitmapLayer,
  fillBitmapLayerAtPoint
} from "./bitmapLayerCanvas";

const layer = (): BitmapLayer => ({
  id: "layer",
  kind: "paint",
  name: "Layer",
  visible: true,
  locked: false,
  opacity: 1,
  blendMode: "normal",
  order: 1,
  bitmapPath: ".storyboard-workbench/layers/shot/layer.png",
  width: 10,
  height: 8
});

const stroke = (): SketchStroke => ({
  id: "stroke",
  tool: "brush",
  color: "#111111",
  size: 4,
  points: [1, 2, 3, 4]
});

describe("bitmapLayerCanvas", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a transparent layer data URL with rounded minimum canvas dimensions", async () => {
    const canvas = {
      width: 0,
      height: 0,
      toDataURL: vi.fn(() => "data:image/png;base64,transparent")
    };
    vi.stubGlobal("document", {
      createElement: vi.fn(() => canvas)
    });

    await expect(createTransparentLayerDataUrl(0.2, 7.6)).resolves.toBe(
      "data:image/png;base64,transparent"
    );
    expect(canvas.width).toBe(1);
    expect(canvas.height).toBe(8);
  });

  it("keeps the source URL when drawing cannot get a canvas context", async () => {
    vi.stubGlobal("document", {
      createElement: vi.fn(() => ({
        getContext: vi.fn(() => null),
        toDataURL: vi.fn()
      }))
    });

    await expect(drawStrokeOnBitmapLayer("source-url", layer(), stroke())).resolves.toBe("source-url");
    await expect(fillBitmapLayerAtPoint("source-url", layer(), { x: 1, y: 1 }, "#fff")).resolves.toBe(
      "source-url"
    );
  });
});
