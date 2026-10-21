import { afterEach, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import { initializeNormalOpenPreviews } from "./normalOpenPreviewService";
import { createPreview } from "./previewService";
import { createProject, mergeFolderImages } from "../../src/shared/projectOps";
import { manualImageImportAdmission } from "../shared/manualImageImportRules";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(p => fs.rm(p, { recursive: true, force: true }))); });
async function fixture() {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), "fresh-layered-preview-")); roots.push(root);
 const imagePath = path.join(root, "saved-layered.tiff"), metadataPath = path.join(root, ".storyboard-workbench/storyboard.project.json"), previewRoot = path.join(root, ".storyboard-workbench/previews");
 await sharp({ create: { width: 4, height: 3, channels: 4, background: "red" } }).tiff({ compression: "none" }).toFile(imagePath);
 const swbMetadata: any = { app: "Storyboard Flow", format: "swb-tiff", version: 1, shotId: "foreign", canvasWidth: 4, canvasHeight: 3,
  layers: [{ id: "paint", kind: "paint", name: "Paint", visible: true, locked: false, opacity: 1, order: 0, width: 4, height: 3 }] };
 const image = { imagePath, fileName: "saved-layered.tiff", width: 4, height: 3, swbMetadata };
 const scan = { folderPath: root, metadataPath, images: [image] };
 const ports = { createImageRecords: async () => [{ ...image, previewPath: await createPreview(imagePath, previewRoot, true) }] };
 return { root, imagePath, metadataPath, previewRoot, swbMetadata, scan, ports };
}
it.each([false, true])("finite foreign layered preview remains fresh with cached=%s, no editable assets or output proof", async cached => {
 const f = await fixture(); if (cached) { await fs.mkdir(f.previewRoot, { recursive: true }); f.scan.images[0] = { ...f.scan.images[0], previewPath: await createPreview(f.imagePath, f.previewRoot) } as any; }
 const before = await fs.readFile(f.imagePath), result = await initializeNormalOpenPreviews(f.scan, f.ports);
 expect((await sharp((result.images[0] as any).previewPath).metadata()).width).toBe(4);
 const p = mergeFolderImages(createProject("foreign"), result.images);
 expect(p.shots[0].swb?.status).toBe("non-swb"); expect(manualImageImportAdmission(p)[0].fresh).toBe(true);
 expect(p.pendingBake).toBeUndefined(); expect(await fs.readFile(f.imagePath)).toEqual(before);
 for (const file of [f.metadataPath, path.join(f.root, "storyboard-script.md"), path.join(f.root, ".storyboard-workbench/layers")]) await expect(fs.stat(file)).rejects.toMatchObject({ code: "ENOENT" });
});
it.each(["version", "layers", "dimensions", "image-only", "leftover", "missing-layers", "invalid-layer"])("foreign preview rejects %s, also with cached preview", async mode => {
 const f = await fixture(); await fs.mkdir(f.previewRoot, { recursive: true });
 (f.scan.images[0] as any).previewPath = await createPreview(f.imagePath, f.previewRoot);
 if (mode === "version") f.swbMetadata.version = 99;
 if (mode === "layers") f.swbMetadata.layers = {};
 if (mode === "missing-layers") delete f.swbMetadata.layers;
 if (mode === "invalid-layer") f.swbMetadata.layers[0] = null;
 if (mode === "dimensions") f.swbMetadata.canvasWidth = 5;
 if (mode === "image-only") f.swbMetadata.layers[0].kind = "image";
 if (mode === "leftover") await fs.mkdir(path.join(f.root, ".storyboard-workbench/layers"));
 const before = await fs.readFile(f.imagePath);
 await expect(initializeNormalOpenPreviews(f.scan, f.ports)).rejects.toThrow();
 expect(await fs.readFile(f.imagePath)).toEqual(before);
});
it.each(["json", "layers", "transaction", "source"])("fresh plan rejects late %s before successful publication", async mode => {
 const f = await fixture();
 const ports = { createImageRecords: async () => {
  const images = await f.ports.createImageRecords();
  if (mode === "json") await fs.writeFile(f.metadataPath, "{}");
  if (mode === "layers") await fs.mkdir(path.join(f.root, ".storyboard-workbench/layers"));
  if (mode === "transaction") await fs.writeFile(path.join(f.root, ".storyboard-workbench/pending-file-transaction.json"), JSON.stringify({ version: 1, moves: [] }));
  if (mode === "source") await fs.appendFile(f.imagePath, "changed");
  return images;
 } };
 await expect(initializeNormalOpenPreviews(f.scan, ports)).rejects.toThrow();
});
