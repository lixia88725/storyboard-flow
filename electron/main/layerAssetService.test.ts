import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  deleteLayerPng,
  readLayerPng,
  resolveLayerAssetPath,
  writeLayerPng
} from "./layerAssetService";

const transparentPixelPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lcWq+wAAAABJRU5ErkJggg==";

describe("layerAssetService", () => {
  it("writes, reads, and deletes layer PNG assets inside the workspace folder", async () => {
    const folderPath = await mkdtemp(path.join(os.tmpdir(), "swb-layer-service-"));
    const payload = {
      folderPath,
      bitmapPath: ".storyboard-workbench/layers/shot-1/layer-1.png",
      dataUrl: transparentPixelPng
    };

    const result = await writeLayerPng(payload);

    expect(result.filePath).toBe(path.join(folderPath, payload.bitmapPath));
    await expect(readFile(result.filePath)).resolves.toBeInstanceOf(Buffer);
    await expect(readLayerPng(payload)).resolves.toBe(transparentPixelPng);
    await expect(deleteLayerPng({ folderPath, bitmapPath: payload.bitmapPath })).resolves.toEqual({
      folderPath,
      bitmapPath: payload.bitmapPath
    });
    await expect(readLayerPng(payload)).resolves.toBeUndefined();
  });

  it("rejects layer asset paths outside the workspace folder", async () => {
    const folderPath = await mkdtemp(path.join(os.tmpdir(), "swb-layer-service-"));

    expect(() => resolveLayerAssetPath(folderPath, "../escape.png")).toThrow(/stay under/);
  });
});
