import { afterEach, describe, expect, it, vi } from "vitest";
import type { BitmapLayer, SketchStroke } from "../shared/types";
import {
  collapseBitmapLayerFromMatte,
  createDialogueOverlayDataUrl,
  createMatteOverlayDataUrl,
  createTransparentLayerDataUrl,
  dialogueOverlayText,
  drawStrokeOnBitmapLayer,
  expandBitmapLayerForMatte,
  fillBitmapLayerAtPoint,
  gaussianBlurBitmapLayer,
  hasBitmapBlurSelection,
  normalizeGaussianBlurRadius
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
    await expect(gaussianBlurBitmapLayer("source-url", layer(), 8)).resolves.toBe("source-url");
  });

  it("normalizes Gaussian blur radii to safe whole-pixel values", () => {
    expect(normalizeGaussianBlurRadius(8.4)).toBe(8);
    expect(normalizeGaussianBlurRadius(8.6)).toBe(9);
    expect(normalizeGaussianBlurRadius(-4)).toBe(0);
    expect(normalizeGaussianBlurRadius(80)).toBe(50);
    expect(normalizeGaussianBlurRadius(Number.NaN)).toBe(0);
    expect(hasBitmapBlurSelection(undefined)).toBe(false);
    expect(hasBitmapBlurSelection([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(false);
    expect(
      hasBitmapBlurSelection([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 }
      ])
    ).toBe(true);
  });

  it("expands a bitmap transparently while offsetting its pixels", async () => {
    const context = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      set fillStyle(_value: string) {}
    };
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
      toDataURL: vi.fn(() => "data:image/png;base64,expanded")
    };
    class MockImage {
      onload: (() => void) | undefined;
      set src(_value: string) {
        this.onload?.();
      }
    }
    vi.stubGlobal("document", { createElement: vi.fn(() => canvas) });
    vi.stubGlobal("Image", MockImage);

    await expect(
      expandBitmapLayerForMatte("source-url", { ...layer(), kind: "image" }, 75, 75)
    ).resolves.toBe("data:image/png;base64,expanded");

    expect(canvas.width).toBe(10);
    expect(canvas.height).toBe(158);
    expect(context.fillRect).not.toHaveBeenCalled();
    expect(context.clearRect).toHaveBeenCalledWith(0, 75, 10, 8);
    expect(context.drawImage).toHaveBeenCalledWith(expect.any(MockImage), 0, 75, 10, 8);
  });

  it("creates opaque black bars on a transparent matte overlay", () => {
    const context = {
      fillRect: vi.fn(),
      set fillStyle(_value: string) {}
    };
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
      toDataURL: vi.fn(() => "data:image/png;base64,matte")
    };
    vi.stubGlobal("document", { createElement: vi.fn(() => canvas) });

    expect(createMatteOverlayDataUrl(1920, 1230, 75, 75)).toBe(
      "data:image/png;base64,matte"
    );
    expect(context.fillRect).toHaveBeenNthCalledWith(1, 0, 0, 1920, 75);
    expect(context.fillRect).toHaveBeenNthCalledWith(2, 0, 1155, 1920, 75);
  });

  it("crops expanded matte padding back to the original bitmap height", async () => {
    const context = {
      drawImage: vi.fn()
    };
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
      toDataURL: vi.fn(() => "data:image/png;base64,collapsed")
    };
    class MockImage {
      onload: (() => void) | undefined;
      set src(_value: string) {
        this.onload?.();
      }
    }
    vi.stubGlobal("document", { createElement: vi.fn(() => canvas) });
    vi.stubGlobal("Image", MockImage);

    await expect(
      collapseBitmapLayerFromMatte(
        "source-url",
        { ...layer(), height: 158 },
        75,
        75,
        8
      )
    ).resolves.toBe("data:image/png;base64,collapsed");
    expect(canvas.width).toBe(10);
    expect(canvas.height).toBe(8);
    expect(context.drawImage).toHaveBeenCalledWith(
      expect.any(MockImage),
      0,
      75,
      10,
      8,
      0,
      0,
      10,
      8
    );
  });

  it("fits ordered dialogue onto one left-aligned lower-matte line", () => {
    const measureText = vi.fn((value: string) => ({ width: value.length * 10 }));
    expect(dialogueOverlayText({ measureText }, "  First   /   Second  ", 500)).toBe(
      "First / Second"
    );
    expect(dialogueOverlayText({ measureText }, "A very long dialogue line", 80)).toMatch(/…$/u);

    const fillText = vi.fn();
    const context = {
      fillText,
      measureText,
      set font(_value: string) {},
      set fillStyle(_value: string) {},
      set textAlign(_value: string) {},
      set textBaseline(_value: string) {},
      set shadowColor(_value: string) {},
      set shadowBlur(_value: number) {}
    };
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
      toDataURL: vi.fn(() => "data:image/png;base64,dialogue")
    };
    vi.stubGlobal("document", { createElement: vi.fn(() => canvas) });

    expect(createDialogueOverlayDataUrl(1920, 1230, 75, "Hello")).toBe(
      "data:image/png;base64,dialogue"
    );
    expect(fillText).toHaveBeenCalledWith("Hello", 38, 1192.5, 1844);
  });

  it("draws the source through the selected Gaussian blur filter", async () => {
    const context = {
      filter: "none",
      clearRect: vi.fn(),
      drawImage: vi.fn()
    };
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
      toDataURL: vi.fn(() => "data:image/png;base64,blurred")
    };
    class MockImage {
      onload: (() => void) | undefined;
      set src(_value: string) {
        this.onload?.();
      }
    }
    vi.stubGlobal("document", { createElement: vi.fn(() => canvas) });
    vi.stubGlobal("Image", MockImage);

    await expect(gaussianBlurBitmapLayer("source-url", layer(), 12)).resolves.toBe(
      "data:image/png;base64,blurred"
    );
    expect(context.drawImage).toHaveBeenCalled();
    expect(context.filter).toBe("blur(12px)");
  });

  it("composites the blurred pixels only through the lasso selection mask", async () => {
    const sourceContext = {
      filter: "none",
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      save: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      clip: vi.fn(),
      restore: vi.fn()
    };
    const blurredContext = {
      filter: "none",
      drawImage: vi.fn()
    };
    const sourceCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => sourceContext),
      toDataURL: vi.fn(() => "data:image/png;base64,selection-blurred")
    };
    const blurredCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => blurredContext),
      toDataURL: vi.fn(() => "data:image/png;base64,full-blurred")
    };
    const canvases = [sourceCanvas, blurredCanvas];
    class MockImage {
      onload: (() => void) | undefined;
      set src(_value: string) {
        this.onload?.();
      }
    }
    vi.stubGlobal("document", { createElement: vi.fn(() => canvases.shift()) });
    vi.stubGlobal("Image", MockImage);

    const selection = [
      { x: 1, y: 2 },
      { x: 8, y: 2 },
      { x: 8, y: 7 },
      { x: 1, y: 7 }
    ];
    await expect(gaussianBlurBitmapLayer("source-url", layer(), 10, selection)).resolves.toBe(
      "data:image/png;base64,selection-blurred"
    );

    expect(blurredContext.filter).toBe("blur(10px)");
    expect(sourceContext.moveTo).toHaveBeenCalledWith(1, 2);
    expect(sourceContext.lineTo).toHaveBeenCalledWith(8, 2);
    expect(sourceContext.clip).toHaveBeenCalledOnce();
    expect(sourceContext.clearRect).toHaveBeenCalledTimes(2);
    expect(sourceContext.clearRect).toHaveBeenLastCalledWith(0, 0, layer().width, layer().height);
    expect(sourceContext.drawImage).toHaveBeenLastCalledWith(blurredCanvas, 0, 0);
    expect(sourceContext.clearRect.mock.invocationCallOrder.at(-1)).toBeLessThan(
      sourceContext.drawImage.mock.invocationCallOrder.at(-1) ?? 0
    );
    expect(sourceContext.restore).toHaveBeenCalledOnce();
    expect(blurredCanvas.toDataURL).not.toHaveBeenCalled();
  });
});
