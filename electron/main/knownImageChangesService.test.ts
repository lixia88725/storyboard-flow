import { describe, expect, it, vi } from "vitest";
import { changedKnownImagePaths } from "./knownImageChangesService.js";

const project = {
  shots: [
    {
      id: "owned",
      imagePath: "/project/owned.tiff",
      swb: {
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
      swb: {
        status: "owned" as const,
        canvasWidth: 1920,
        canvasHeight: 1080,
        baseFingerprint: "same-pixels"
      }
    },
    {
      id: "external",
      imagePath: "/project/external.tiff",
      swb: {
        status: "non-swb" as const,
        canvasWidth: 1920,
        canvasHeight: 1080
      }
    }
  ]
};

describe("knownImageChangesService", () => {
  it("returns known SWB TIFF paths whose fingerprints or metadata changed", async () => {
    const pixelFingerprint = vi.fn(async (imagePath: string) =>
      imagePath === "/project/owned.tiff" ? "new-pixels" : "same-pixels"
    );
    const readSwbMetadata = vi.fn(async (imagePath: string) => ({
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
          readSwbMetadata,
          onProgress
        }
      )
    ).resolves.toEqual(["/project/owned.tiff"]);

    expect(pixelFingerprint).toHaveBeenCalledTimes(2);
    expect(pixelFingerprint).toHaveBeenCalledWith("/project/owned.tiff");
    expect(pixelFingerprint).toHaveBeenCalledWith("/project/parked.tif");
    expect(readSwbMetadata).toHaveBeenCalledTimes(2);
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
    const readSwbMetadata = vi.fn(async () => undefined);

    await expect(
      changedKnownImagePaths(project, ["/project/owned.tiff"], new Set(["/project/owned.tiff"]), {
        pixelFingerprint,
        readSwbMetadata
      })
    ).resolves.toEqual([]);

    expect(pixelFingerprint).not.toHaveBeenCalled();
    expect(readSwbMetadata).not.toHaveBeenCalled();
  });

  it("skips a known Pending file that was renamed or removed externally", async () => {
    const missingError = Object.assign(new Error("missing"), { code: "ENOENT" });
    const pixelFingerprint = vi.fn(async () => {
      throw missingError;
    });

    await expect(
      changedKnownImagePaths(project, ["/project/parked.tif"], new Set(), {
        pixelFingerprint,
        readSwbMetadata: vi.fn()
      })
    ).resolves.toEqual([]);
  });
});
