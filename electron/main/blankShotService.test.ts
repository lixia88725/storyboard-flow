import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { createBlankShot } from "./blankShotService.js";

describe("blankShotService", () => {
  it("creates unique blank TIFF shots for the selected preset", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "swb-blank-shot-"));
    const folderPath = path.join(root, "workspace");

    try {
      const firstPath = await createBlankShot(folderPath, "2.39:1");
      const secondPath = await createBlankShot(folderPath, "2.39:1");
      const metadata = await sharp(firstPath).metadata();

      expect(path.dirname(firstPath)).toBe(folderPath);
      expect(path.basename(firstPath)).toMatch(/^new_shot_\d+_0\.tiff$/);
      expect(secondPath).not.toBe(firstPath);
      expect(metadata.format).toBe("tiff");
      expect(metadata.width).toBe(2581);
      expect(metadata.height).toBe(1080);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("creates 9:16 phone blank TIFF shots", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "swb-blank-shot-phone-"));
    const folderPath = path.join(root, "workspace");

    try {
      const imagePath = await createBlankShot(folderPath, "9:16");
      const metadata = await sharp(imagePath).metadata();

      expect(metadata.format).toBe("tiff");
      expect(metadata.width).toBe(1080);
      expect(metadata.height).toBe(1920);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
