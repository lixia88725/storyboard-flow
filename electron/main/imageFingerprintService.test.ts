import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { pixelFingerprint } from "./imageFingerprintService";

const writeImage = async (
  filePath: string,
  size: { width: number; height: number },
  background: string
): Promise<void> => {
  await sharp({
    create: {
      width: size.width,
      height: size.height,
      channels: 3,
      background
    }
  })
    .png()
    .toFile(filePath);
};

describe("imageFingerprintService", () => {
  it("creates stable pixel fingerprints that include image dimensions", async () => {
    const folder = await mkdtemp(path.join(os.tmpdir(), "swb-image-fingerprint-"));
    const first = path.join(folder, "first.png");
    const samePixels = path.join(folder, "same-pixels.png");
    const differentPixels = path.join(folder, "different-pixels.png");
    const differentSize = path.join(folder, "different-size.png");

    await writeImage(first, { width: 2, height: 2 }, "#ffffff");
    await writeImage(samePixels, { width: 2, height: 2 }, "#ffffff");
    await writeImage(differentPixels, { width: 2, height: 2 }, "#000000");
    await writeImage(differentSize, { width: 3, height: 2 }, "#ffffff");

    const fingerprint = await pixelFingerprint(first);

    expect(await pixelFingerprint(samePixels)).toBe(fingerprint);
    expect(await pixelFingerprint(differentPixels)).not.toBe(fingerprint);
    expect(await pixelFingerprint(differentSize)).not.toBe(fingerprint);
  });
});
