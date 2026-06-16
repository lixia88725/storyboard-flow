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
});
