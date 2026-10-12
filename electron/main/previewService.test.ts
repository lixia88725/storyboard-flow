import { mkdtemp, readFile, rm, stat, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { previewPathForImage } from "./previewPaths.js";
import { createPreview } from "./previewService.js";

describe("createPreview", () => {
  it("returns a rollback receipt for a replaced preview instead of losing the old cache", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "preview-replacement-receipt-"));
    const image = path.join(root, "source.tiff"), previews = path.join(root, ".storyboard-workbench/previews");
    const receipts: Array<{ effect: string; rollback: () => Promise<void> }> = [];
    try {
      await sharp({ create: { width: 2, height: 2, channels: 4, background: "red" } }).tiff().toFile(image);
      const preview = await createPreview(image, previews), old = await readFile(preview), identity = await stat(preview);
      await sharp({ create: { width: 2, height: 2, channels: 4, background: "blue" } }).tiff().toFile(image);
      await utimes(preview, new Date(1000), new Date(1000));
      await createPreview(image, previews, false, receipt => { receipts.push(receipt); });
      expect(receipts).toHaveLength(1);
      expect(receipts[0].effect).toBe("replaced");
      expect(await readFile(preview)).not.toEqual(old);
      // A regenerated cache must be readable on the next real read-only open;
      // copying old security metadata must not copy its stale freshness marker.
      await expect(createPreview(image, previews, true)).resolves.toBe(preview);
      await receipts[0].rollback();
      expect(await readFile(preview)).toEqual(old);
      expect((await stat(preview)).ino).toBe(identity.ino);
      await receipts[0].rollback();
    } finally { await rm(root, { recursive: true, force: true }); }
  });

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
