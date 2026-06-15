import { mkdtemp, rm, stat, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { previewPathForImage } from "./previewPaths.js";
import { createPreview } from "./previewService.js";

describe("createPreview", () => {
  it("writes a bounded png preview at the deterministic preview path", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "storyboard-flow-preview-"));
    const imagePath = path.join(root, "shot.tiff");
    const previewRoot = path.join(root, ".storyboard-workbench", "previews");

    try {
      await sharp({
        create: {
          width: 2400,
          height: 1600,
          channels: 3,
          background: "#ffffff"
        }
      })
        .tiff()
        .toFile(imagePath);

      const previewPath = await createPreview(imagePath, previewRoot);
      const metadata = await sharp(previewPath).metadata();

      expect(previewPath).toBe(previewPathForImage(imagePath, previewRoot));
      expect(metadata.format).toBe("png");
      expect(metadata.width).toBeLessThanOrEqual(1800);
      expect(metadata.height).toBeLessThanOrEqual(1200);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reuses a fresh existing preview", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "storyboard-flow-preview-cache-"));
    const imagePath = path.join(root, "shot.tiff");
    const previewRoot = path.join(root, ".storyboard-workbench", "previews");

    try {
      await sharp({
        create: {
          width: 100,
          height: 100,
          channels: 3,
          background: "#ffffff"
        }
      })
        .tiff()
        .toFile(imagePath);

      const previewPath = await createPreview(imagePath, previewRoot);
      const originalMtimeMs = (await stat(previewPath)).mtimeMs;
      await utimes(imagePath, new Date(1000), new Date(1000));
      await utimes(previewPath, new Date(2000), new Date(2000));

      await createPreview(imagePath, previewRoot);

      expect((await stat(previewPath)).mtimeMs).not.toBe(originalMtimeMs);
      expect((await stat(previewPath)).mtimeMs).toBe(2000);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
