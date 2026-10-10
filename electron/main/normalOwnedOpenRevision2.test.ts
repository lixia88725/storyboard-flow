import { afterEach, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import ts from "typescript";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { createWorkspaceFolderScanner } from "./workspaceScanService";
import { createWorkspaceOpenAppHandlers } from "./workspaceOpenAppRuntime";
import { registerWorkspaceOpenIpcHandlers } from "./ipc/workspaceOpenHandlers";
import { createImageRecords as createImportedImageRecords } from "./imageRecordsService";
import { createPreview } from "./previewService";
import { previewPathForImage } from "./previewPaths";
import { pixelFingerprint } from "./imageFingerprintService";
import { readProjectMetadata } from "./projectMetadataService";
import * as transaction from "./pendingFileTransactionService";
import { createProject } from "../../src/shared/projectOps";
vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof fs>();
  return { ...actual, mkdir: vi.fn(actual.mkdir), writeFile: vi.fn(actual.writeFile), rename: vi.fn(actual.rename), unlink: vi.fn(actual.unlink) };
});
const dirs: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(dirs.splice(0).map(p => fs.rm(p, { recursive: true, force: true }))); });
const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
async function workspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "normal-owned-revision2-")); dirs.push(root);
  const metadataPath = path.join(root, ".storyboard-workbench/storyboard.project.json"), journal = path.join(root, ".storyboard-workbench/pending-file-transaction.json"), previewRoot = path.join(root, ".storyboard-workbench/previews"), image = path.join(root, "a.tiff"), md = path.join(root, "storyboard-script.md");
  await fs.mkdir(path.dirname(metadataPath), { recursive: true });
  await sharp({ create: { width: 4, height: 3, channels: 4, background: "red" } }).tiff({ compression: "none" }).toFile(image);
  const source = await fs.readFile(new URL("./main.ts", import.meta.url), "utf8"), ast = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
  const names = ["scanWorkspaceFolder", "scanFolder", "ensureStoryboardScriptMarkdown", "readProject", "createImageRecords", "readSwbMetadata"];
  const selected = ast.statements.filter(n => ts.isVariableStatement(n) && names.includes(n.declarationList.declarations[0].name.getText(ast)));
  expect(selected).toHaveLength(names.length);
  const order: string[] = [];
  const bindings = { path, sharp, sharpSourceOptions: { unlimited: true }, swbXmpTag: "swb:metadata", readFile: fs.readFile, readProjectMetadata, ...transaction,
    hasPendingFileTransaction: async (p: string) => { order.push("transaction-check"); return transaction.hasPendingFileTransaction(p); },
    createWorkspaceFolderScanner, metadataPathForFolder: () => metadataPath, previewRootForFolder: () => previewRoot,
    collectImagePaths: async () => { order.push("image-discovery"); return [image]; }, createImportedImageRecords, createPreview, pixelFingerprint,
    storyboardScriptPathForFolder: () => md, storyboardScriptNeedsImport: () => false,
    writeStoryboardScriptMarkdown: async () => { await fs.writeFile(md, "generated"); } };
  const scanFolder = new Function(...Object.keys(bindings), ts.transpile(selected.map(n => n.getText(ast)).join("\n") + ";return scanFolder;", { target: ts.ScriptTarget.ES2022 }))(...Object.values(bindings));
  let invoke!: (...args: any[]) => Promise<any>;
  registerWorkspaceOpenIpcHandlers({ handle: (_name: string, fn: any) => { invoke = fn; } } as any, createWorkspaceOpenAppHandlers({ scanFolder, createProgressReporter: () => undefined, pathExists: async () => true, addRecentFolder: () => {}, removeRecentFolder: () => {} }));
  return { root, metadataPath, journal, previewRoot, image, md, order, open: (options?: unknown) => invoke({ sender: {} }, root, options) };
}
function watchWrites() {
  return [vi.mocked(fs.mkdir).mockClear(), vi.spyOn(sharp.prototype, "toFile"), vi.mocked(fs.writeFile).mockClear(), vi.mocked(fs.rename).mockClear(), vi.mocked(fs.unlink).mockClear()];
}
async function snapshot(root: string): Promise<Record<string, string>> {
  const entries: Record<string, string> = {};
  const walk = async (dir: string) => {
    for (const name of await fs.readdir(dir)) {
      const p = path.join(dir, name), s = await fs.lstat(p), key = path.relative(root, p);
      if (s.isSymbolicLink()) entries[key] = `link:${await fs.readlink(p)}`;
      else if (s.isDirectory()) { entries[key] = "directory"; await walk(p); }
      else entries[key] = hash(await fs.readFile(p));
    }
  }; await walk(root); return entries;
}
it.each([false, true])("actual owned open without JSON and missing TIFF preview performs zero writes, retained transaction=%s", async retained => {
  const f = await workspace();
  if (retained) await fs.writeFile(f.journal, JSON.stringify({ version: 1, moves: [{ fromPath: f.image, toPath: path.join(f.root, "Pending/a.tiff") }] }));
  const before = await snapshot(f.root), writes = watchWrites();
  // Missing TIFF browser preview is an explicit incomplete open, not undefined media + success.
  await expect(f.open({ normalSave: true })).rejects.toThrow(/preview.*read.only|read.only.*preview/i);
  writes.forEach(w => expect(w).not.toHaveBeenCalled()); expect(await snapshot(f.root)).toEqual(before);
  expect(f.order.indexOf("transaction-check")).toBeLessThan(f.order.indexOf("image-discovery"));
});
it("actual malformed JSON reader throws before image discovery and preserves every file", async () => {
  const f = await workspace(); await fs.writeFile(f.metadataPath, "{broken-json");
  const before = await snapshot(f.root), writes = watchWrites();
  await expect(f.open({ normalSave: true })).rejects.toThrow(SyntaxError);
  writes.forEach(w => expect(w).not.toHaveBeenCalled()); expect(f.order).not.toContain("image-discovery"); expect(await snapshot(f.root)).toEqual(before);
});
it("actual readonly TIFF records reuse a safe fresh PNG with real metadata and fingerprint and no writes", async () => {
  const f = await workspace(), preview = await createPreview(f.image, f.previewRoot), before = await snapshot(f.root), writes = watchWrites();
  const scan = await f.open({ normalSave: true });
  expect(scan.images).toHaveLength(1); expect(scan.images[0]).toMatchObject({ imagePath: f.image, previewPath: preview, width: 4, height: 3, fingerprint: await pixelFingerprint(f.image) });
  expect((await sharp(scan.images[0].previewPath).raw().toBuffer())[0]).toBe(255);
  writes.forEach(w => expect(w).not.toHaveBeenCalled()); expect(await snapshot(f.root)).toEqual(before);
});
it.each(["stale", "leaf-link", "parent-link", "invalid-png"])("actual readonly TIFF preview refuses %s without cache updates", async mode => {
  const f = await workspace(), preview = await createPreview(f.image, f.previewRoot);
  if (mode === "stale") await fs.utimes(preview, new Date(1000), new Date(1000));
  if (mode === "leaf-link") { const other = path.join(f.root, "other.png"); await fs.rename(preview, other); await fs.symlink(other, preview); }
  if (mode === "parent-link") { const other = path.join(f.root, "other-previews"); await fs.rename(f.previewRoot, other); await fs.symlink(other, f.previewRoot); }
  if (mode === "invalid-png") await fs.writeFile(preview, "not a png");
  const before = await snapshot(f.root), writes = watchWrites();
  await expect(f.open({ normalSave: true })).rejects.toThrow(); writes.forEach(w => expect(w).not.toHaveBeenCalled()); expect(await snapshot(f.root)).toEqual(before);
});
it.each(["source-parent-alias", "multi-resolved-overlap", "existing-inode-alias", "normalized-endpoint-overlap"])("explicit recovery rejects %s before its first effect, preserving real TIFF PNG JSON and transaction", async mode => {
  const f = await workspace(), pending = path.join(f.root, "Pending"), c = path.join(f.root, "c.tiff");
  const identity = hash(await fs.readFile(f.image));
  if (mode === "source-parent-alias" || mode === "multi-resolved-overlap") await fs.symlink(f.root, pending);
  else await fs.mkdir(pending);
  const ids = mode === "source-parent-alias" ? ["c"] : ["a", "c"];
  const shots = [];
  for (const id of ids) {
    const bitmapPath = `.storyboard-workbench/layers/${id}/image.png`;
    await fs.mkdir(path.dirname(path.join(f.root, bitmapPath)), { recursive: true });
    await sharp({ create: { width: 4, height: 3, channels: 4, background: "blue" } }).png().toFile(path.join(f.root, bitmapPath));
    shots.push({ id, imagePath: id === "a" ? f.image : c, swb: { status: "owned" }, layers: [{ bitmapPath }] });
  }
  let moves = mode === "source-parent-alias" ? [{ fromPath: c, toPath: path.join(pending, "a.tiff") }] : [{ fromPath: f.image, toPath: path.join(pending, "b.tiff") }, { fromPath: c, toPath: path.join(pending, "a.tiff") }];
  if (mode === "existing-inode-alias") { await fs.link(f.image, path.join(pending, "d.tiff")); moves[1].toPath = path.join(pending, "d.tiff"); }
  if (mode === "normalized-endpoint-overlap") {
    // Both missing destination spellings resolve to the same parent+leaf.
    await fs.writeFile(c, await fs.readFile(f.image));
    moves[1] = { fromPath: c, toPath: `${pending}/./b.tiff` };
  }
  const project = { ...createProject("Synthetic alias"), shots, pendingBake: { version: 1, shots: Object.fromEntries(ids.map(id => [id, { state: "pending", editToken: id, acceptedOutputIdentity: identity }])) } };
  await fs.writeFile(f.metadataPath, JSON.stringify(project)); await fs.writeFile(f.journal, JSON.stringify({ version: 1, moves }));
  const before = await snapshot(f.root), writes = watchWrites();
  await expect(f.open({ normalSave: true, recoverPending: true })).rejects.toThrow(/unsafe|ambiguous|alias|directory|unsupported/i);
  writes.forEach(w => expect(w).not.toHaveBeenCalled()); expect(await snapshot(f.root)).toEqual(before);
});
it("explicit recovery rejects missing case-only destination aliases before the first move, preserving the entire real workspace", async () => {
  const f = await workspace(), pending = path.join(f.root, "Pending");
  await fs.mkdir(pending);
  const shots = [], entries: Record<string, unknown> = {}, moves = [];
  for (const [id, leaf, color] of [["a", "b.tiff", "red"], ["c", "B.tiff", "green"]]) {
    const source = path.join(f.root, `${id}.tiff`), target = path.join(pending, leaf), bitmapPath = `.storyboard-workbench/layers/${id}/image.png`;
    if (id === "c") await sharp({ create: { width: 4, height: 3, channels: 4, background: color } }).tiff({ compression: "none" }).toFile(source);
    entries[id] = { state: "pending", editToken: id, acceptedOutputIdentity: hash(await fs.readFile(source)) };
    await expect(fs.lstat(target)).rejects.toMatchObject({ code: "ENOENT" });
    await fs.mkdir(path.dirname(path.join(f.root, bitmapPath)), { recursive: true });
    await sharp({ create: { width: 4, height: 3, channels: 4, background: "blue" } }).png().toFile(path.join(f.root, bitmapPath));
    shots.push({ id, imagePath: target, swb: { status: "owned" }, layers: [{ bitmapPath }] });
    moves.push({ fromPath: source, toPath: target });
  }
  expect((entries.a as any).acceptedOutputIdentity).not.toBe((entries.c as any).acceptedOutputIdentity);
  await fs.writeFile(f.metadataPath, JSON.stringify({ ...createProject("Synthetic missing case aliases"), shots, pendingBake: { version: 1, shots: entries } }));
  await fs.writeFile(f.journal, JSON.stringify({ version: 1, moves }));
  const protectedPaths = [f.image, path.join(f.root, "c.tiff"), f.metadataPath, f.journal, ...shots.map(s => path.join(f.root, s.layers[0].bitmapPath))];
  const originalBytes = await Promise.all(protectedPaths.map(p => fs.readFile(p)));
  const before = await snapshot(f.root), writes = watchWrites();
  await expect(f.open({ normalSave: true, recoverPending: true })).rejects.toThrow(/alias/i);
  writes.forEach(w => expect(w).not.toHaveBeenCalled());
  expect(await Promise.all(protectedPaths.map(p => fs.readFile(p)))).toEqual(originalBytes);
  expect(await snapshot(f.root)).toEqual(before);
});
it("explicit recovery accepts a legitimate disjoint two-move plan and preserves internal artwork", async () => {
  const f = await workspace(), pending = path.join(f.root, "Pending"); await fs.mkdir(pending);
  const shots = [], entries: Record<string, unknown> = {}, moves = [], protectedPaths = [];
  for (const id of ["a", "c"]) {
    const imagePath = path.join(f.root, `${id}.tiff`), parked = path.join(pending, `${id}.tiff`), bitmapPath = `.storyboard-workbench/layers/${id}/image.png`;
    if (id === "c") await sharp({ create: { width: 4, height: 3, channels: 4, background: "green" } }).tiff({ compression: "none" }).toFile(imagePath);
    entries[id] = { state: "pending", editToken: id, acceptedOutputIdentity: hash(await fs.readFile(imagePath)) };
    await fs.rename(imagePath, parked); moves.push({ fromPath: imagePath, toPath: parked });
    await fs.mkdir(path.dirname(path.join(f.root, bitmapPath)), { recursive: true }); await sharp({ create: { width: 4, height: 3, channels: 4, background: "blue" } }).png().toFile(path.join(f.root, bitmapPath));
    protectedPaths.push(path.join(f.root, bitmapPath)); shots.push({ id, imagePath, swb: { status: "owned" }, layers: [{ bitmapPath }] });
  }
  await fs.writeFile(f.metadataPath, JSON.stringify({ ...createProject("Synthetic legal"), shots, pendingBake: { version: 1, shots: entries } })); await fs.writeFile(f.journal, JSON.stringify({ version: 1, moves }));
  protectedPaths.push(f.metadataPath); const before = await Promise.all(protectedPaths.map(p => fs.readFile(p)));
  await f.open({ normalSave: true, recoverPending: true });
  for (const shot of shots) expect(hash(await fs.readFile(shot.imagePath))).toBe((entries[shot.id] as any).acceptedOutputIdentity);
  expect(await Promise.all(protectedPaths.map(p => fs.readFile(p)))).toEqual(before); await expect(fs.stat(f.journal)).rejects.toMatchObject({ code: "ENOENT" });
});
it("actual legacy no-JSON TIFF open still creates a readable bounded preview", async () => {
  const f = await workspace(), writes = watchWrites(), scan = await f.open();
  expect(scan.images[0].previewPath).toBe(previewPathForImage(f.image, f.previewRoot));
  expect((await sharp(scan.images[0].previewPath).metadata()).format).toBe("png");
  expect(writes[0]).toHaveBeenCalled(); expect(writes[1]).toHaveBeenCalled();
});
