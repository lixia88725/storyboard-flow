import { describe, expect, it, vi } from "vitest";
import { createCurrentLayerActionController } from "./currentLayerActionController";
import type { Shot } from "../shared/types";

const shotWithLayers = (): Shot => ({
  id: "shot-1",
  imagePath: "/tmp/shot.tiff",
  fileName: "shot.tiff",
  order: 0,
  activeLayerId: "paint-1",
  layers: [
    {
      id: "image",
      kind: "image",
      name: "Image",
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: "normal",
      order: 0,
      bitmapPath: "image.png",
      width: 16,
      height: 16
    },
    {
      id: "paint-1",
      kind: "paint",
      name: "Layer",
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: "normal",
      order: 1,
      bitmapPath: "paint.png",
      width: 16,
      height: 16
    }
  ]
});

describe("currentLayerActionController", () => {
  it("shows a status message when clearing without a selected shot", () => {
    const handleClearBitmapLayer = vi.fn();
    const setStatus = vi.fn();
    const controller = createCurrentLayerActionController({
      getPrimarySelectedShot: () => undefined,
      getBlurRadius: () => 8,
      handleBlurBitmapLayer: vi.fn(),
      handleClearBitmapLayer,
      setStatus
    });

    controller.handleClearCurrentLayerFromToolRail();

    expect(setStatus).toHaveBeenCalledWith("Select a shot before clearing a layer");
    expect(handleClearBitmapLayer).not.toHaveBeenCalled();
  });

  it("clears the active visible bitmap layer for the selected shot", () => {
    const handleClearBitmapLayer = vi.fn();
    const controller = createCurrentLayerActionController({
      getPrimarySelectedShot: shotWithLayers,
      getBlurRadius: () => 8,
      handleBlurBitmapLayer: vi.fn(),
      handleClearBitmapLayer,
      setStatus: vi.fn()
    });

    controller.handleClearCurrentLayerFromToolRail();

    expect(handleClearBitmapLayer).toHaveBeenCalledWith("shot-1", "paint-1");
  });

  it("applies the selected Gaussian blur radius to the editable active layer", async () => {
    const handleBlurBitmapLayer = vi.fn().mockResolvedValue("blurred");
    const setStatus = vi.fn();
    const controller = createCurrentLayerActionController({
      getPrimarySelectedShot: shotWithLayers,
      getBlurRadius: () => 14.4,
      handleBlurBitmapLayer,
      handleClearBitmapLayer: vi.fn(),
      setStatus
    });

    await controller.handleApplyBlurFromToolRail();

    expect(handleBlurBitmapLayer).toHaveBeenCalledWith(shotWithLayers(), "paint-1", 14);
    expect(setStatus).toHaveBeenCalledWith("Applied 14px Gaussian blur to Layer");
  });

  it("refuses to blur when every visible layer is locked", async () => {
    const lockedShot = shotWithLayers();
    lockedShot.layers = lockedShot.layers?.map((layer) => ({ ...layer, locked: true }));
    const handleBlurBitmapLayer = vi.fn();
    const setStatus = vi.fn();
    const controller = createCurrentLayerActionController({
      getPrimarySelectedShot: () => lockedShot,
      getBlurRadius: () => 8,
      handleBlurBitmapLayer,
      handleClearBitmapLayer: vi.fn(),
      setStatus
    });

    await controller.handleApplyBlurFromToolRail();

    expect(handleBlurBitmapLayer).not.toHaveBeenCalled();
    expect(setStatus).toHaveBeenCalledWith("Select an unlocked visible layer before applying blur");
  });

  it("does not fall back to another layer when the selected active layer is locked", async () => {
    const lockedActiveShot = shotWithLayers();
    lockedActiveShot.layers = lockedActiveShot.layers?.map((layer) =>
      layer.id === "paint-1" ? { ...layer, locked: true } : layer
    );
    const handleBlurBitmapLayer = vi.fn();
    const setStatus = vi.fn();
    const controller = createCurrentLayerActionController({
      getPrimarySelectedShot: () => lockedActiveShot,
      getBlurRadius: () => 8,
      handleBlurBitmapLayer,
      handleClearBitmapLayer: vi.fn(),
      setStatus
    });

    await controller.handleApplyBlurFromToolRail();

    expect(handleBlurBitmapLayer).not.toHaveBeenCalled();
    expect(setStatus).toHaveBeenCalledWith("Select an unlocked visible layer before applying blur");
  });
});
