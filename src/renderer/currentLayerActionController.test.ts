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
      handleClearBitmapLayer,
      setStatus: vi.fn()
    });

    controller.handleClearCurrentLayerFromToolRail();

    expect(handleClearBitmapLayer).toHaveBeenCalledWith("shot-1", "paint-1");
  });
});
