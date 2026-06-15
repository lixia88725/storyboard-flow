import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectImagePaths, metadataPathForFolder } from "./imageDiscoveryService.js";

const tempRoots: string[] = [];

const createTempRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), "swb-image-discovery-"));
  tempRoots.push(root);
  return root;
};

describe("imageDiscoveryService", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("collects supported top-level image paths once in stable path order", async () => {
    const root = await createTempRoot();
    const nested = path.join(root, "nested");
    await mkdir(nested);
    const imageA = path.join(root, "b.tiff");
    const imageB = path.join(root, "a.png");
    const imageC = path.join(root, "c.JPG");
    await Promise.all([
      writeFile(imageA, ""),
      writeFile(imageB, ""),
      writeFile(imageC, ""),
      writeFile(path.join(root, "notes.txt"), ""),
      writeFile(path.join(root, ".storyboard-copy-id-copy.tiff"), ""),
      writeFile(path.join(nested, "nested.png"), "")
    ]);

    await expect(collectImagePaths([root, imageA])).resolves.toEqual([imageB, imageA, imageC]);
  });

  it("resolves the legacy project metadata path inside the workspace folder", () => {
    expect(metadataPathForFolder("/scene")).toBe("/scene/.storyboard-workbench/storyboard.project.json");
  });
});
