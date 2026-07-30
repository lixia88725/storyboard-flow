import { describe, expect, it, vi } from "vitest";
import { createStoryboardImageProtocolHandler } from "./appProtocolRuntime.js";

describe("createStoryboardImageProtocolHandler", () => {
  it("routes storyboard image protocol requests through the injected fetch", async () => {
    const fetchFileUrl = vi.fn(async () => new Response("ok"));
    const handler = createStoryboardImageProtocolHandler({ fetchFileUrl });

    const response = await handler({
      url: "storyboard-img://image?path=%2Ftmp%2FStoryboard%20Flow%2Fshot%201.png"
    });

    expect(response.status).toBe(200);
    expect(fetchFileUrl).toHaveBeenCalledWith("file:///tmp/Storyboard%20Flow/shot%201.png");
  });

  it("resolves validated bitmap layer paths before fetching them", async () => {
    const fetchFileUrl = vi.fn(async () => new Response("ok"));
    const resolveLayerAssetPath = vi.fn(
      (folderPath: string, bitmapPath: string) => `${folderPath}/${bitmapPath}`
    );
    const handler = createStoryboardImageProtocolHandler({
      fetchFileUrl,
      resolveLayerAssetPath
    });

    const response = await handler({
      url:
        "storyboard-img://layer?folderPath=%2Fscene&bitmapPath=" +
        encodeURIComponent(".storyboard-workbench/layers/shot-a/layer-image.png") +
        "&revision=4"
    });

    expect(response.status).toBe(200);
    expect(resolveLayerAssetPath).toHaveBeenCalledWith(
      "/scene",
      ".storyboard-workbench/layers/shot-a/layer-image.png"
    );
    expect(fetchFileUrl).toHaveBeenCalledWith(
      "file:///scene/.storyboard-workbench/layers/shot-a/layer-image.png"
    );
  });

  it("rejects layer paths that fail validation", async () => {
    const fetchFileUrl = vi.fn(async () => new Response("ok"));
    const handler = createStoryboardImageProtocolHandler({
      fetchFileUrl,
      resolveLayerAssetPath: () => {
        throw new Error("outside layer root");
      }
    });

    const response = await handler({
      url: "storyboard-img://layer?folderPath=%2Fscene&bitmapPath=..%2Fsecret.png"
    });

    expect(response.status).toBe(400);
    expect(fetchFileUrl).not.toHaveBeenCalled();
  });

  it("returns a quiet 404 for a validated layer asset that does not exist yet", async () => {
    const handler = createStoryboardImageProtocolHandler({
      fetchFileUrl: vi.fn(async () => {
        throw new Error("net::ERR_FILE_NOT_FOUND");
      }),
      resolveLayerAssetPath: (folderPath, bitmapPath) => `${folderPath}/${bitmapPath}`
    });

    const response = await handler({
      url:
        "storyboard-img://layer?folderPath=%2Fscene&bitmapPath=" +
        encodeURIComponent(".storyboard-workbench/layers/shot-a/new-layer.png")
    });

    expect(response.status).toBe(404);
  });
});
