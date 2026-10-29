import { describe, expect, it, vi } from "vitest";
import { changedKnownImagePaths } from "./knownImageChangesService.js";

const project = {
  shots: [
    {
      id: "owned",
      imagePath: "/project/owned.tiff",
      flow: {
        status: "owned" as const,
        canvasWidth: 1920,
        canvasHeight: 1080,
        baseFingerprint: "old-pixels"
      }
    },
    {
      id: "png",
      imagePath: "/project/flat.png"
    }
  ],
  parkedShots: [
    {
      id: "parked",
      imagePath: "/project/parked.tif",
      flow: {
        status: "owned" as const,
        canvasWidth: 1920,
        canvasHeight: 1080,
        baseFingerprint: "same-pixels"
      }
    },
    {
      id: "external",
      imagePath: "/project/external.tiff",
      flow: {
        status: "non-flow" as const,
        canvasWidth: 1920,
        canvasHeight: 1080
      }
    }
  ]
};

describe("knownImageChangesService", () => {
  it("returns known FLOW TIFF paths whose fingerprints or metadata changed", async () => {
    const pixelFingerprint = vi.fn(async (imagePath: string) =>
      imagePath === "/project/owned.tiff" ? "new-pixels" : "same-pixels"
    );
    const readFlowMetadata = vi.fn(async (imagePath: string) => ({
      shotId: imagePath === "/project/owned.tiff" ? "owned" : "parked",
      canvasWidth: 1920,
      canvasHeight: 1080,
      baseFingerprint: imagePath === "/project/owned.tiff" ? "old-pixels" : "same-pixels"
    }));
    const onProgress = vi.fn();

    await expect(
      changedKnownImagePaths(
        project,
        [
          "/project/owned.tiff",
          "/project/parked.tif",
          "/project/external.tiff",
          "/project/flat.png",
          "/project/new.tiff"
        ],
        new Set(),
        {
          pixelFingerprint,
          readFlowMetadata,
          onProgress
        }
      )
    ).resolves.toEqual(["/project/owned.tiff"]);

    expect(pixelFingerprint).toHaveBeenCalledTimes(2);
    expect(pixelFingerprint).toHaveBeenCalledWith("/project/owned.tiff");
    expect(pixelFingerprint).toHaveBeenCalledWith("/project/parked.tif");
    expect(readFlowMetadata).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress).toHaveBeenLastCalledWith({
      kind: "open",
      label: "Checking external changes...",
      current: 3,
      total: 3
    });
  });

  it("skips pending-deleted known TIFF paths", async () => {
    const pixelFingerprint = vi.fn(async () => "new-pixels");
    const readFlowMetadata = vi.fn(async () => undefined);

    await expect(
      changedKnownImagePaths(project, ["/project/owned.tiff"], new Set(["/project/owned.tiff"]), {
        pixelFingerprint,
        readFlowMetadata
      })
    ).resolves.toEqual([]);

    expect(pixelFingerprint).not.toHaveBeenCalled();
    expect(readFlowMetadata).not.toHaveBeenCalled();
  });

  it("skips a known Pending file that was renamed or removed externally", async () => {
    const missingError = Object.assign(new Error("missing"), { code: "ENOENT" });
    const pixelFingerprint = vi.fn(async () => {
      throw missingError;
    });

    await expect(
      changedKnownImagePaths(project, ["/project/parked.tif"], new Set(), {
        pixelFingerprint,
        readFlowMetadata: vi.fn()
      })
    ).resolves.toEqual([]);
  });
});
