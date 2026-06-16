import { describe, expect, it, vi } from "vitest";
import { createLayerAppHandlers } from "./layerAppRuntime.js";

describe("createLayerAppHandlers", () => {
  it("delegates layer IPC payloads to layer asset services", async () => {
    const writeLayerPng = vi.fn(async (payload) => ({ ...payload, filePath: "/scene/layer.png" }));
    const readLayerPng = vi.fn(async () => "data:image/png;base64,png");
    const deleteLayerPng = vi.fn(async (payload) => payload);
    const copyLayerPng = vi.fn(async (payload) => ({ ...payload, targetFilePath: "/scene/copy.png" }));
    const mergeLayerDown = vi.fn(async (payload) => ({ ...payload, targetFilePath: "/scene/merged.png" }));
    const mergeVisibleLayers = vi.fn(async (payload) => ({ ...payload, targetFilePath: "/scene/visible.png" }));

    const handlers = createLayerAppHandlers({
      copyLayerPng,
      deleteLayerPng,
      mergeLayerDown,
      mergeVisibleLayers,
      readLayerPng,
      writeLayerPng
    });
    const payload = { folderPath: "/scene", bitmapPath: ".storyboard-workbench/layers/layer.png" };

    await expect(handlers.writePng(payload)).resolves.toEqual({
      ...payload,
      filePath: "/scene/layer.png"
    });
    await expect(handlers.readPng(payload)).resolves.toBe("data:image/png;base64,png");
    await expect(handlers.deletePng(payload)).resolves.toBe(payload);
    await expect(handlers.copyPng(payload)).resolves.toEqual({
      ...payload,
      targetFilePath: "/scene/copy.png"
    });
    await expect(handlers.mergeDown(payload)).resolves.toEqual({
      ...payload,
      targetFilePath: "/scene/merged.png"
    });
    await expect(handlers.mergeVisible(payload)).resolves.toEqual({
      ...payload,
      targetFilePath: "/scene/visible.png"
    });
  });
});
