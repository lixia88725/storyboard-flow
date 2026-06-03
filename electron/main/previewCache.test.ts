import { mkdtemp, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { previewIsFresh } from "./previewCache.js";

describe("previewIsFresh", () => {
  it("reuses previews that are newer than the source image", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "swb-preview-cache-"));
    const sourcePath = path.join(root, "source.tiff");
    const previewPath = path.join(root, "preview.png");
    await writeFile(sourcePath, "source");
    await writeFile(previewPath, "preview");
    await utimes(sourcePath, new Date(1000), new Date(1000));
    await utimes(previewPath, new Date(2000), new Date(2000));

    expect(await previewIsFresh(sourcePath, previewPath)).toBe(true);
  });

  it("regenerates previews when the source image is newer or the preview is missing", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "swb-preview-cache-"));
    const sourcePath = path.join(root, "source.tiff");
    const previewPath = path.join(root, "preview.png");
    await writeFile(sourcePath, "source");
    await writeFile(previewPath, "preview");
    await utimes(sourcePath, new Date(3000), new Date(3000));
    await utimes(previewPath, new Date(2000), new Date(2000));

    expect(await previewIsFresh(sourcePath, previewPath)).toBe(false);
    expect(await previewIsFresh(sourcePath, path.join(root, "missing.png"))).toBe(false);
  });
});
