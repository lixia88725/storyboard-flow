import { createAppOpenCallerScope } from './appOpenCallerScope.mjs';
import { appCallerAdapterScope, createAppRootActor } from '../../src/renderer/appCallerAdapterScope';
import { isCertifiedPendingBakeEntry } from "../shared/pendingBakeRules";
import { afterEach, expect, it, vi } from "vitest";
// Ref-backed History stacks only; production controller, shared queue, main Import and PNG IO
// stay real. This is not a mounted React/native-window assertion.
vi.mock("react", () => ({ useState: (v: unknown) => [v, () => {}],
  useRef: (v: unknown) => ({ current: v }), useEffect: (f: () => void) => f(),
  useCallback: (f: unknown) => f, useMemo: (f: () => unknown) => f() }));
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import ts from "typescript";
import sharp from "sharp";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createProject, ensureBitmapLayerMetadata, addImportedImages, sceneMatteModeForProject, sceneDialogueOverlayEnabledForProject, dialogueOverlayBitmapLayerId } from "../../src/shared/projectOps";
import type { Project, FolderScanPayload, ImportSwbFormatPayload } from "../../src/shared/types";
import { prepareImportedImageMatte } from "../../src/renderer/normalSaveImportMatte";
import { createNormalSaveAppAdapter } from "../../src/renderer/normalSaveAppAdapter";
import { createBitmapLayerWriteQueue } from "../../src/renderer/bitmapLayerWriteQueue";
import { useBitmapLayerPaintingController } from "../../src/renderer/bitmapLayerPaintingController";
import { useProjectHistoryController } from "../../src/renderer/projectHistoryController";
import { registerWorkspaceAutosave } from "../../src/renderer/workspaceAutosaveController";
import { automaticImageImportAdmission, manualImageImportAdmission } from "../shared/manualImageImportRules";
import { refreshWorkspaceExternalImportState } from "../../src/renderer/workspaceExternalRefreshController";
import { mergeExternalImageChanges } from "../../src/shared/projectOps";
import { pendingBakeForProject } from "../../src/shared/pendingBake";
import * as renames from "./fileRenames";
import * as importPorts from "./photoshopTiffImport";
import * as bitmap from "./bitmapLayers";
import * as safety from "./pathSafety";
import * as layer from "./layerAssetService";
import { writeProtectedLayerFile as protectedWriter } from "./protectedLayerFileWriter";
import { prepareProtectedLayerReplacement } from "./protectedLayerReplacementPreparation";
import { withLayerFileOperation } from "./layerFileOperationQueue";
import { mapWithConcurrency } from "./mapWithConcurrency";
import { removeOwnedFile, type OwnedFileReceipt } from "./ownedFileCreation";
import * as tiffPreparation from "./tiffPreparation";
import * as script from "./storyboardScript";
import { bitmapLayersForShot } from "./bitmapLayerOrdering";
import { pixelFingerprint } from "./imageFingerprintService";
import { createImportPathReservation } from "./importPaths";
import { prepareImportStaging } from "./importPreparation";
import { withSuccessfulSaveArtifactCleanup } from "./saveArtifacts";
import { recoverFailedImport } from "./importRecovery";
import { previewRootForFolder } from "./previewPaths";
import { createPreview } from "./previewService";
import { writePhotoshopLayeredTiffsForInPlaceSave } from "./photoshopTiffExport";
import { hasPendingFileTransaction } from "./pendingFileTransactionService";
import { registerWorkspacePersistenceIpcHandlers } from "./ipc/workspacePersistenceHandlers";
import { createBlankShot } from "./blankShotService";
import { createImageRecords as createImportedImageRecords } from "./imageRecordsService";
import { ImportRecoveryIncompleteError } from "./importRecovery";
import { normalSaveImportFailure } from "./normalSaveImportFailure";
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(p => fs.rm(p, { recursive: true, force: true }))); });
const hash = async (p: string) => createHash("sha256").update(await fs.readFile(p)).digest("hex");
const source = await fs.readFile(new URL("./main.ts", import.meta.url), "utf8");
const barrier = () => { let release!: () => void; const promise = new Promise<void>(r => release = r); return { promise, release }; };
it("successful real compatible Import commits its old PNG backups instead of leaving undeclared recovery files", async () => {
  const f = await autoFixture();
  f.ref.current = mergeExternalImageChanges(f.ref.current, [f.image]);
  expect(await f.run()).toBe(true);
  const entries = await fs.readdir(path.join(f.root, ".storyboard-workbench/import-tmp"), { recursive: true });
  expect(entries.filter(entry => entry.includes("layer-backup") && entry.endsWith(".png"))).toEqual([]);
});

it.skipIf(process.platform !== "darwin").each([0, 1])("compatible Import refuses ACL-protected old layer %s before replacing any old bytes or security metadata", async protectedLayerIndex => {
  const run = promisify(execFile);
  const f = await fixture("layered"); expect(await f.run()).toBe(true);
  const before = f.ref.current.shots[0];
  const oldFile = path.join(f.root, before.layers![protectedLayerIndex].bitmapPath);

  const allOriginalBytes = await Promise.all(before.layers!.map(layer => fs.readFile(path.join(f.root, layer.bitmapPath))));
  const oldPng = await fs.readFile(oldFile);
  const externalLayers = await Promise.all(before.layers!.map(async (layer, i) => {
    const bitmapPath = `.storyboard-workbench/layers/external/l${i}.png`;
    await fs.mkdir(path.dirname(path.join(f.root, bitmapPath)), { recursive: true });
    await sharp({ create: { width: 4, height: 3, channels: 4, background: i ? "yellow" : "green" } }).png().toFile(path.join(f.root, bitmapPath));
    return { ...layer, bitmapPath };
  }));
  const external = await writePhotoshopLayeredTiffsForInPlaceSave({ ...f.ref.current, shots: [{ ...before, layers: externalLayers }] }, f.root, { scriptPath: path.join(process.cwd(), "scripts/photoshop-layered-tiff-export.py"), saveStamp: "external", env: process.env });
  await fs.copyFile(external.replacements[0].fromPath, before.imagePath);
  f.ref.current = { ...f.ref.current, shots: [{ ...before, swb: { ...before.swb!, status: "compatible-external-edit" } }], pendingBake: { version: 1, shots: { s: { state: "synced", acceptedOutputIdentity: f.ref.current.pendingBake!.shots.s.acceptedOutputIdentity } } } };
  const user = (await run("/usr/bin/id", ["-un"])).stdout.trim();
  await run("/bin/chmod", ["+a", `user:${user} deny write`, oldFile]);
  const probe = async () => JSON.parse((await run("python3", ["-B", path.resolve("scripts/layer-file-permissions.py"), oldFile])).stdout);
  const protectedBefore = await probe();
  expect(protectedBefore.kind).toBe("special");
  const result = await f.run();

  expect.soft(result).toBe(false);
  expect.soft(await fs.readFile(oldFile)).toEqual(oldPng);
  expect.soft(await probe()).toEqual(protectedBefore);
  // Every old layer keeps its exact bytes when any one of them is refused, so a
  // refusal can never leave an earlier replacement applied.
  expect(await Promise.all(before.layers!.map(layer => fs.readFile(path.join(f.root, layer.bitmapPath))))).toEqual(allOriginalBytes);
}, 30000);
it.each(["manual", "automatic"] as const)("dual-needed %s image stage retains the actual external Markdown input for script continuation", async mode => {
  const f = await autoFixture();
  const external = { ...f.ref.current, shots: f.ref.current.shots.map(s => ({ ...s, scriptText: "external script must survive image stage" })) };
  const markdown = script.serializeStoryboardScriptMarkdown(external);
  await fs.writeFile(f.mdPath, markdown, "utf8");
  expect(script.storyboardScriptNeedsImport(f.ref.current, await fs.readFile(f.mdPath, "utf8"))).toBe(true);
  const imageProject = mergeExternalImageChanges(f.ref.current, [f.image]);
  expect(imageProject.shots[0].swb!.status).toBe("compatible-external-edit");
  f.io.mockClear();
  if (mode === "automatic") {
    f.checks.mockImplementation(async () => ({ images: [f.image], scriptImportNeeded: script.storyboardScriptNeedsImport(f.ref.current, await fs.readFile(f.mdPath, "utf8")) }));
    await f.refresh();
  } else {
    f.ref.current = imageProject;
    expect(await f.run()).toBe(true);
  }
  expect(f.errors).toEqual([]);
  expect(f.io.mock.calls.filter(([p]) => p.normalSaveImageImport || p.normalSaveAutoImageImport)).toHaveLength(1);
  expect(f.io.mock.calls.filter(([p]) => !p.normalSaveImageImport && !p.normalSaveAutoImageImport)).toHaveLength(1);
  expect(f.ref.current.shots[0].swb!.status).toBe("owned");
  // Original external input protection: it must be consumed, never replaced by old text.
  expect(f.ref.current.shots[0].scriptText).toBe("external script must survive image stage");
  expect(await fs.readFile(f.mdPath, "utf8")).toBe(markdown);
  expect(script.storyboardScriptNeedsImport(f.ref.current, await fs.readFile(f.mdPath, "utf8"))).toBe(false);
  expect(JSON.parse(await fs.readFile(f.metadataPath, "utf8"))).toEqual(JSON.parse(JSON.stringify(f.ref.current)));
});
it("observed absent MD created during image preparation is retained before JSON", async () => {
  const f = await autoFixture();
  await fs.unlink(f.mdPath);
  f.published.mockClear();
  f.ref.current = mergeExternalImageChanges(f.ref.current, [f.image]);
  const json = await fs.readFile(f.metadataPath);
  const external = "1. external created after absence observation\n";
  expect(await f.run({ prepare: async p => { await fs.writeFile(f.mdPath, external); return p; } })).toBe(false);
  expect(await fs.readFile(f.mdPath, "utf8")).toBe(external);
  expect(await fs.readFile(f.metadataPath)).toEqual(json);
  expect(f.recovery.current).toBeDefined();
  expect(f.published).not.toHaveBeenCalled();
});
it.each([false, true])("early blank preview failure reports actual rollback incomplete=%s", async incomplete => {
  const f = await dualFixture();
  await fs.writeFile(f.mdPath, "1. \n2. early blank\n");
  let first = true;
  f.beforePersist(async () => { if (first) { first = false; f.setEarlyPreviewFault(incomplete); } });
  expect(await f.run()).toBe(false);
  expect(f.ref.current.shots[0].swb!.status).toBe("owned");
  if (incomplete) {
    expect(f.recovery.current).toMatch(/recovery required/);
    expect(f.errors.at(-1)).toMatchObject({ message: expect.stringMatching(/early blank preview failure.*rollback EPERM/) });
    const files = await fs.readdir(f.root);
    const blanks = files.filter(p => p.startsWith("new_shot_"));
    expect(blanks.length).toBeGreaterThan(0);
    const bytes = await Promise.all(blanks.map(p => fs.readFile(path.join(f.root, p))));
    const calls = f.io.mock.calls.length, writes = f.writes.length;
    expect(await f.run()).toBe(false); expect(await f.adapter.save()).toBe(false); expect(await f.adapter.autosave(f.ref.current)).toBe(false);
    expect(f.io.mock.calls).toHaveLength(calls); expect(f.writes).toHaveLength(writes);
    expect(await Promise.all(blanks.map(p => fs.readFile(path.join(f.root, p))))).toEqual(bytes);
  } else {
    expect(f.recovery.current).toBeUndefined();
    expect(f.adapter.owner.scriptImportRemaining).toBe(true);
    expect((await fs.readdir(f.root)).filter(p => p.startsWith("new_shot_"))).toEqual([]);
    f.clearEarlyPreviewFault();
    expect(await f.run()).toBe(true);
    expect(f.io.mock.calls.filter(([p]) => p.normalSaveImageImport)).toHaveLength(1);
  }
});
it("observed absent MD unchanged legally initializes required MD", async () => {
  const f = await autoFixture(); await fs.unlink(f.mdPath);
  f.ref.current = mergeExternalImageChanges(f.ref.current, [f.image]);
  expect(await f.run()).toBe(true);
  expect(await fs.readFile(f.mdPath, "utf8")).toBe(script.serializeStoryboardScriptMarkdown(f.ref.current));
});
it("observed absent MD external creation after JSON is retained before MD write", async () => {
  const f = await autoFixture(); await fs.unlink(f.mdPath);
  f.ref.current = mergeExternalImageChanges(f.ref.current, [f.image]);
  const external = "1. created during JSON install\n";
  f.afterJson(async () => { await fs.writeFile(f.mdPath, external); });
  {
    expect(await f.run()).toBe(false);
    expect(await fs.readFile(f.mdPath, "utf8")).toBe(external);
    expect(f.recovery.current).toBeDefined();
  }
});
it("early helper double failure waits all started preview cleanup before plain envelope recovery", async () => {
  const f = await dualFixture(), gate = barrier();
  await fs.writeFile(f.mdPath, "1. \n2. first real blank\n3. second failing blank\n");
  let first = true; f.beforePersist(async () => { if (first) { first = false; f.setSecondBlankFault(gate); } });
  let settled = false; const task = f.run().finally(() => { settled = true; });
  try {
    await vi.waitFor(() => expect(f.cleanupStarted).toHaveBeenCalled());
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(settled).toBe(false); expect(f.recovery.current).toBeUndefined();
  } finally { gate.release(); }
  expect(await task).toBe(false); expect(f.cleanupSettled).toHaveBeenCalled();
  expect(f.recovery.current).toBeDefined();
  expect(f.errors.at(-1)).toMatchObject({ message: expect.stringMatching(/second blank creation failed.*rollback EPERM/) });
  const result = await f.io.mock.results.at(-1)!.value;
  expect(result).not.toBeInstanceOf(Error); expect(result).toMatchObject({ ok: false });
});
async function dualFixture() {
  const f = await autoFixture();
  const markdown = "1. external frozen text\n";
  await fs.writeFile(f.mdPath, markdown);
  f.ref.current = mergeExternalImageChanges(f.ref.current, [f.image]);
  f.io.mockClear();
  return { ...f, markdown };
}
it("dual-needed script pre-effect failure retains completed image facts and input; actual App retry skips pixels", async () => {
  const f = await dualFixture(), io = f.io.getMockImplementation()!;
  let failing = true, imagePrepareCount = 0;
  const scriptPublished = vi.fn();
  f.io.mockImplementation(async payload => {
    if (!payload.normalSaveImageImport && !payload.normalSaveAutoImageImport && failing) throw new Error("script reader unavailable before effects");
    return io(payload);
  });
  expect(await f.run({ prepare: async p => { imagePrepareCount++; return p; }, scriptPublished })).toBe(false);
  expect(f.ref.current.shots[0].swb!.status).toBe("owned");
  expect(f.ref.current.pendingBake!.shots.s.state).toBe("pending");
  expect(f.recovery.current).toBeUndefined(); expect(f.adapter.owner.scriptImportRemaining).toBe(true);
  expect(f.errors[0]).toMatchObject({ message: expect.stringMatching(/Image Import completed, script Import incomplete/) });
  expect(scriptPublished).not.toHaveBeenCalled(); expect(await fs.readFile(f.mdPath, "utf8")).toBe(f.markdown);
  const pngPath = path.join(f.root, f.ref.current.shots[0].layers![0].bitmapPath), png = await fs.readFile(pngPath);
  const writes = f.writes.length;
  expect(await f.adapter.autosave(f.ref.current)).toBe(false); expect(await f.adapter.save()).toBe(false);
  expect(await f.adapter.ensureLayerAssets()).toBe(false);
  expect(await f.adapter.pending("park", p => ({ ...p, shots: [], parkedShots: p.shots }), ["s"])).toBe(false);
  expect(f.writes).toHaveLength(writes); expect(await fs.readFile(f.mdPath, "utf8")).toBe(f.markdown);
  failing = false;
  expect(await f.run({ scriptPublished })).toBe(true);
  expect(imagePrepareCount).toBe(1); expect(await fs.readFile(pngPath)).toEqual(png);
  expect(f.io.mock.calls.filter(([p]) => p.normalSaveImageImport)).toHaveLength(1);
  expect(f.ref.current.shots[0].scriptText).toBe("external frozen text");
  expect(f.adapter.owner.scriptImportRemaining).toBe(false); expect(scriptPublished).toHaveBeenCalledOnce();
});
it("dual-needed external input changed during script required persistence is a conflict not an overwrite", async () => {
  const f = await dualFixture(); let n = 0;
  const changed = "1. newer external text\n";
  f.beforePersist(async () => { n++; if (n === 2) await fs.writeFile(f.mdPath, changed); });
  expect(await f.run()).toBe(false);
  expect(await fs.readFile(f.mdPath, "utf8")).toBe(changed);
  expect(f.recovery.current).toBeDefined(); expect(f.ref.current.pendingBake!.shots.s.state).toBe("unknown");
  expect(f.adapter.owner.scriptImportRemaining).toBe(true);
});
it("dual-needed keeps both stages inside the same owned queue through script ACK", async () => {
  const f = await dualFixture(), io = f.io.getMockImplementation()!, entered = barrier(), held = barrier();
  f.io.mockImplementation(async p => { if (!p.normalSaveImageImport) { entered.release(); await held.promise; } return io(p); });
  const operation = f.run(); await entered.promise;
  let released = false; const next = f.queue.runExclusive(async () => { released = true; });
  expect(released).toBe(false); expect(await fs.readFile(f.mdPath, "utf8")).toBe(f.markdown);
  held.release(); expect(await operation).toBe(true); await next; expect(released).toBe(true);
  expect(f.ref.current.shots[0].scriptText).toBe("external frozen text");
});
it.each(["metadata", "text", "order", "dialogue", "canvas"] as const)("dual-needed original image-stage dependency governs %s P2", async kind => {
  const f = await dualFixture(), io = f.io.getMockImplementation()!;
  f.io.mockImplementation(async p => {
    const scan = await io(p);
    if (p.normalSaveImageImport) f.adapter.owner.publishEdit(project => {
      if (kind === "metadata") return { ...project, name: "latest safe P2" };
      if (kind === "dialogue") return { ...project, dialogues: [{ id: "d", shotId: "s", text: "new derived dependency", order: 0 }] };
      if (kind === "canvas") return { ...project, shots: project.shots.map(s => ({ ...s, swb: { ...s.swb!, canvasHeight: 99 } })) };
      return { ...project, shots: project.shots.map(s => ({ ...s, ...(kind === "text" ? { scriptText: "new local text" } : { order: s.order + 1 }) })) };
    }, []);
    return scan;
  });
  expect(await f.run()).toBe(kind === "metadata");
  if (kind === "metadata") {
    expect(f.ref.current.name).toBe("latest safe P2"); expect(f.ref.current.shots[0].scriptText).toBe("external frozen text");
    expect(JSON.parse(await fs.readFile(f.metadataPath, "utf8")).name).toBe("latest safe P2");
  } else {
    expect(await fs.readFile(f.mdPath, "utf8")).toBe(f.markdown);
    expect(f.io.mock.calls.filter(([p]) => !p.normalSaveImageImport)).toHaveLength(0);
    expect(f.recovery.current).toBeDefined();
    if (kind === "text") expect(f.ref.current.shots[0].scriptText).toBe("new local text");
  }
});
it.each(["input", "text"] as const)("dual-needed failed script retry refuses changed original %s instead of recapturing", async kind => {
  const f = await dualFixture(), io = f.io.getMockImplementation()!;
  let failing = true;
  f.io.mockImplementation(p => !p.normalSaveImageImport && failing ? Promise.reject(new Error("pre-effect script failure")) : io(p));
  expect(await f.run()).toBe(false); failing = false;
  if (kind === "input") await fs.writeFile(f.mdPath, "1. changed external input\n");
  else f.adapter.owner.publishEdit(p => ({ ...p, shots: p.shots.map(s => ({ ...s, scriptText: "changed local text" })) }), []);
  const md = await fs.readFile(f.mdPath), png = await fs.readFile(path.join(f.root, f.ref.current.shots[0].layers![0].bitmapPath));
  expect(await f.run()).toBe(false); expect(f.adapter.owner.scriptImportRemaining).toBe(true);
  if (kind === "input") expect(f.io.mock.calls.at(-1)![0].normalSaveScriptInput).toBe(f.markdown);
  expect(await fs.readFile(f.mdPath)).toEqual(md); expect(await fs.readFile(path.join(f.root, f.ref.current.shots[0].layers![0].bitmapPath))).toEqual(png);
  expect(f.io.mock.calls.filter(([p]) => p.normalSaveImageImport)).toHaveLength(1);
});
it.each(["image-MD", "script-MD"] as const)("dual-needed actual %s failure retains external source and real recovery gate", async phase => {
  const f = await dualFixture(); let n = 0;
  f.beforePersist(async () => { n++; if (n === (phase === "image-MD" ? 1 : 2)) f.setFault(); });
  expect(await f.run()).toBe(false); expect(await fs.readFile(f.mdPath, "utf8")).toBe(f.markdown);
  expect(f.recovery.current).toBeDefined(); expect(f.ref.current.pendingBake!.shots.s.state).toBe("unknown");
  const calls = f.io.mock.calls.length, bytes = await fs.readFile(path.join(f.root, f.ref.current.shots[0].layers![0].bitmapPath));
  expect(await f.run()).toBe(false); expect(await f.adapter.save()).toBe(false); expect(await f.adapter.autosave(f.ref.current)).toBe(false);
  expect(f.io.mock.calls.length).toBe(calls); expect(await fs.readFile(path.join(f.root, f.ref.current.shots[0].layers![0].bitmapPath))).toEqual(bytes);
});
it.each(["unknown", "future", "retained"] as const)("dual-needed %s admission retains all real files before first effect", async kind => {
  const f = await dualFixture();
  if (kind === "unknown") f.ref.current.pendingBake!.shots.s = { state: "unknown", opaque: "keep" } as any;
  if (kind === "future") f.ref.current.pendingBake = { version: 99, raw: "keep", shots: {} } as any;
  if (kind === "retained") await fs.writeFile(path.join(f.root, ".storyboard-workbench/pending-file-transaction.json"), JSON.stringify({ version: 1, moves: [] }));
  const raw = JSON.stringify(f.ref.current.pendingBake), files = [f.mdPath, f.metadataPath, f.ref.current.shots[0].imagePath, path.join(f.root, f.ref.current.shots[0].layers![0].bitmapPath)], bytes = await Promise.all(files.map(p => fs.readFile(p)));
  expect(await f.run()).toBe(false);
  if (kind !== "retained") expect(JSON.stringify(f.ref.current.pendingBake)).toBe(raw);
  else expect(await hasPendingFileTransaction(f.root)).toBe(true); // existing conservative renderer recovery gate is unchanged
  expect(await Promise.all(files.map(p => fs.readFile(p)))).toEqual(bytes);
});
it("dual-needed queue-wait ABA refuses old request before source or raster effects", async () => {
  const f = await dualFixture(), held = barrier();
  const old = f.queue.runExclusive(() => held.promise), task = f.adapter.imageImport({ blankShotPreset: "16:9", dirtyShotIds: [], prepare: async p => p, published: f.published });
  const b = f.adapter.owner.load({ ...createProject("B"), pendingBake: { version: 1, shots: {} } });
  const a = f.adapter.owner.load({ ...createProject("A again"), pendingBake: { version: 1, shots: {} } });
  held.release(); await old; expect(await task).toBe(false); await b; await a;
  expect(f.io).not.toHaveBeenCalled(); expect(f.ref.current.name).toBe("A again"); expect(await fs.readFile(f.mdPath, "utf8")).toBe(f.markdown);
});
it("dual-needed actual main parser materializes new blank TIFF PNG and owner pending identity in same Import", async () => {
  const f = await dualFixture(); await fs.writeFile(f.mdPath, "1. \n2. newly imported blank\n");
  expect(await f.run()).toBe(true); expect(f.ref.current.shots).toHaveLength(2);
  const blank = f.ref.current.shots.find(s => s.id !== "s")!;
  expect(blank.scriptText).toBe("newly imported blank"); expect((await sharp(blank.imagePath).metadata()).width).toBe(1920);
  expect((await sharp(path.join(f.root, blank.layers![0].bitmapPath)).metadata()).width).toBe(1920);
  expect(f.ref.current.pendingBake!.shots[blank.id]).toMatchObject({ state: "pending", acceptedOutputIdentity: await hash(blank.imagePath) });
  expect(await fs.readFile(f.mdPath, "utf8")).toBe(script.serializeStoryboardScriptMarkdown(f.ref.current));
});
it.each([false, true])("dual-needed actual new-blank PNG failure keeps completed image facts, rollback-incomplete=%s", async rollback => {
  const f = await dualFixture(); const markdown = "1. \n2. real blank failure\n"; await fs.writeFile(f.mdPath, markdown);
  let first = true;
  f.beforePersist(async () => { if (first) { first = false; f.setScriptLayerFault(rollback); } });
  expect(await f.run()).toBe(false);
  expect(f.ref.current.shots[0].swb!.status).toBe("owned"); expect(await fs.readFile(f.mdPath, "utf8")).toBe(markdown);
  expect(f.adapter.owner.scriptImportRemaining).toBe(true);
  const imageCalls = f.io.mock.calls.filter(([p]) => p.normalSaveImageImport).length;
  if (rollback) {
    expect(f.recovery.current).toBeDefined(); expect(f.ref.current.pendingBake!.shots.s.state).toBe("unknown");
    expect((await fs.readdir(f.root)).some(p => p.startsWith("new_shot_"))).toBe(true);
    expect(await f.run()).toBe(false); expect(f.io.mock.calls.filter(([p]) => p.normalSaveImageImport)).toHaveLength(imageCalls);
  } else {
    expect(f.recovery.current).toBeUndefined(); expect(f.ref.current.pendingBake!.shots.s.state).toBe("pending");
    expect((await fs.readdir(f.root)).some(p => p.startsWith("new_shot_"))).toBe(false);
  }
});
it("dual-needed main freezes actual input before PNG effect; a later external edit is retained", async () => {
  const f = await dualFixture(), io = f.io.getMockImplementation()!; let frozen: string | undefined;
  f.io.mockImplementation(async p => { const result = await io(p); frozen = result.normalSaveScriptInput; return result; });
  const newer = "1. changed after main PNG effect\n";
  expect(await f.run({ prepare: async p => { expect(frozen).toBe(f.markdown); await fs.writeFile(f.mdPath, newer); return p; } })).toBe(false);
  expect(await fs.readFile(f.mdPath, "utf8")).toBe(newer); expect(f.recovery.current).toBeDefined();
  expect(f.io).toHaveBeenCalledOnce();
});
it("dual-needed automatic callback publishes consumed script need instead of stale earlier observation", async () => {
  const f = await autoFixture(); await fs.writeFile(f.mdPath, "1. actual automatic script\n");
  f.checks.mockImplementation(async () => ({ images: [f.image], scriptImportNeeded: true }));
  f.io.mockClear(); await f.refresh();
  expect(f.bindings.setScriptImportNeeded).toHaveBeenLastCalledWith(false);
  expect(f.ref.current.shots[0].scriptText).toBe("actual automatic script");
  expect(f.bindings.normalSaveScriptImportPublished).toHaveBeenCalledOnce();
});
it("dual-needed manual preserve/duplicate uses frozen original script plan without unexpected blanks", async () => {
  const f = await dualFixture(); f.ref.current.pendingBake!.shots.s = { ...f.ref.current.pendingBake!.shots.s, state: "pending", editToken: "local-preserved" };
  const pngs = await Promise.all(f.ref.current.shots[0].layers!.map(l => fs.readFile(path.join(f.root, l.bitmapPath))));
  expect(await f.run()).toBe(true); expect(f.ref.current.shots).toHaveLength(2);
  expect(f.ref.current.shots.every(s => s.scriptText === "external frozen text")).toBe(true);
  expect(f.ref.current.pendingBake!.shots.s.editToken).toBe("local-preserved");
  expect(await Promise.all(f.ref.current.shots.find(s => s.id === "s")!.layers!.map(l => fs.readFile(path.join(f.root, l.bitmapPath))))).toEqual(pngs);
  expect((await fs.readdir(f.root)).some(p => p.startsWith("new_shot_"))).toBe(false);
  expect(await fs.readFile(f.mdPath, "utf8")).toBe(script.serializeStoryboardScriptMarkdown(f.ref.current));
});
it("dual-needed final script ACK consumes input despite metadata P3 and releases fresh ordinary autosave", async () => {
  const f = await dualFixture(); let n = 0;
  f.beforePersist(async () => { n++; if (n === 2 || n === 3) f.adapter.owner.publishEdit(p => ({ ...p, name: `script P${n}` }), []); });
  expect(await f.run()).toBe(false); expect(f.ref.current.name).toBe("script P3");
  expect(f.ref.current.shots[0].scriptText).toBe("external frozen text"); expect(f.adapter.owner.scriptImportRemaining).toBe(false);
  expect(await f.adapter.autosave(f.ref.current)).toBe(true);
  expect(JSON.parse(await fs.readFile(f.metadataPath, "utf8")).name).toBe("script P3");
  expect(f.io.mock.calls.filter(([p]) => p.normalSaveImageImport)).toHaveLength(1);
});
it("image-only observation still refuses newly changed external Markdown before required writer", async () => {
  const f = await autoFixture(); f.ref.current = mergeExternalImageChanges(f.ref.current, [f.image]);
  const newer = "1. external change arrived during image stage\n";
  expect(await f.run({ prepare: async p => { await fs.writeFile(f.mdPath, newer); return p; } })).toBe(false);
  expect(await fs.readFile(f.mdPath, "utf8")).toBe(newer); expect(f.recovery.current).toBeDefined();
});
it("dual-needed actual App partial publication and error/Close remain incomplete until script retry", async () => {
  const f = await dualFixture(), controls = await actualErrorAndClose(f), io = f.io.getMockImplementation()!;
  const text = await fs.readFile(new URL("../../src/renderer/App.tsx", import.meta.url), "utf8"), tree = ts.createSourceFile("App.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const expressions: Record<string, string> = {};
  const visit = (n: ts.Node) => { if (ts.isVariableDeclaration(n) && ["normalSaveImageImportPublished", "normalSaveScriptImportPublished"].includes(n.name.getText(tree))) expressions[n.name.getText(tree)] = n.initializer!.getText(tree); ts.forEachChild(n, visit); }; visit(tree);
  const bindings = { project: f.ref.current, projectRef: f.ref, invalidatePresentationHistory: vi.fn(),
    normalSaveAppCallbacksRef: { current: { onPendingPublication: vi.fn() } }, setScriptImportNeeded: vi.fn(), setStatus: vi.fn() };
  const compile = (name: string) => new Function(...Object.keys(appCallerAdapterScope(bindings)), ts.transpile(`return (${expressions[name]});`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(appCallerAdapterScope(bindings)));
  let failing = true;
  f.io.mockImplementation(p => !p.normalSaveImageImport && failing ? Promise.reject(new Error("ordinary script pre-effect failure")) : io(p));
  expect(await f.run({ published: compile("normalSaveImageImportPublished") })).toBe(false);
  expect(bindings.setScriptImportNeeded).toHaveBeenLastCalledWith(true);
  expect(bindings.setStatus).toHaveBeenLastCalledWith("Image Import completed; storyboard script Import remains incomplete");
  expect(controls.refs.workspaceSaveStateRef.current).toBe("error"); expect(controls.refs.setSaveErrorDialog).toHaveBeenCalled(); await controls.close();
  failing = false;
  expect(await f.run({ scriptPublished: compile("normalSaveScriptImportPublished") })).toBe(true);
  expect(bindings.setScriptImportNeeded).toHaveBeenLastCalledWith(false);
  expect(bindings.setStatus).toHaveBeenLastCalledWith("Imported storyboard script changes; output pending Save");
});
it("automatic local pending conflict retains PNG TIFF Archive JSON MD and never calls Import", async () => {
  const f = await autoFixture(), s = f.ref.current.shots[0]; f.io.mockClear();
  const files = [s.imagePath, path.join(f.root, s.layers![0].bitmapPath), s.swb!.archivePath!, f.metadataPath, f.mdPath];
  const before = await Promise.all(files.map(p => fs.readFile(p)));
  f.adapter.owner.publishEdit(p => p, ["s"]); const token = f.ref.current.pendingBake!.shots.s.editToken;
  await f.refresh(); expect(f.io).not.toHaveBeenCalled(); expect(f.errors).toHaveLength(1);
  expect(f.ref.current.pendingBake!.shots.s).toMatchObject({ state: "pending", editToken: token });
  expect(await Promise.all(files.map(p => fs.readFile(p)))).toEqual(before);
});
it("automatic queued stale refresh does zero scan identity Import or persistence I/O", async () => {
  const f = await autoFixture(), held = barrier(); f.io.mockClear();
  const old = f.queue.runExclusive(() => held.promise), writes = f.writes.length;
  const refresh = f.refresh(); f.adapter.owner.publishEdit(p => ({ ...p, name: "P2" }), []);
  held.release(); await old; await refresh;
  expect(f.checks).not.toHaveBeenCalled(); expect(f.io).not.toHaveBeenCalled(); expect(f.writes).toHaveLength(writes); expect(f.errors).toEqual([]);
});
it("automatic scan awaits old I/O and read-wait same-folder ABA never adopts stale result or error", async () => {
  const f = await autoFixture(), hold = barrier(), read = barrier(), entered = barrier(); f.io.mockClear();
  const old = f.queue.runExclusive(() => hold.promise); const refresh = f.refresh();
  await Promise.resolve(); expect(f.checks).not.toHaveBeenCalled();
  f.checks.mockImplementation(async () => { entered.release(); await read.promise; throw new Error("old scan error"); });
  hold.release(); await old; await entered.promise;
  const loadB = f.adapter.owner.load({ ...createProject("B"), pendingBake: { version: 1, shots: {} } });
  const loadA = f.adapter.owner.load({ ...createProject("new A"), pendingBake: { version: 1, shots: {} } });
  read.release(); await refresh; await loadB; await loadA;
  expect(f.errors).toEqual([]); expect(f.io).not.toHaveBeenCalled(); expect(f.ref.current.name).toBe("new A");
  expect(f.bindings.setScriptImportNeeded).not.toHaveBeenCalled();
});
it("automatic identical read-only scan leaves epoch sequence project refs and disk unchanged", async () => {
  const f = await autoFixture(), s = f.ref.current.shots[0];
  f.image.fingerprint = await pixelFingerprint(s.imagePath);
  f.ref.current = { ...f.ref.current, shots: [{ ...s, swb: { ...s.swb!, baseFingerprint: f.image.fingerprint } }], pendingBake: { version: 1, shots: { s: { state: "synced", acceptedOutputIdentity: await hash(s.imagePath) } } } };
  f.io.mockClear();
  const c = f.adapter.owner.capture(), json = await fs.readFile(f.metadataPath), n = f.writes.length;
  await f.refresh(); expect(f.adapter.owner.capture()).toEqual(c); expect(f.io).not.toHaveBeenCalled(); expect(f.writes).toHaveLength(n);
  expect(await fs.readFile(f.metadataPath)).toEqual(json); expect(f.errors).toEqual([]);
});
it.each(["pending", "unknown", "manual", "preserve", "no-normal"])("actual main automatic permission cannot bypass %s guard", async mode => {
  const f = await autoFixture(), project = mergeExternalImageChanges(f.ref.current, [f.image]);
  const s = project.shots[0], files = [s.imagePath, path.join(f.root, s.layers![0].bitmapPath), f.metadataPath];
  const bytes = await Promise.all(files.map(p => fs.readFile(p)));
  if (mode === "pending") project.pendingBake!.shots.s = { ...project.pendingBake!.shots.s, state: "pending", editToken: "local" };
  if (mode === "unknown") project.pendingBake!.shots.s = { state: "unknown" };
  await expect(f.io({ project, folderPath: f.root, metadataPath: f.metadataPath, normalSave: mode !== "no-normal", normalSaveAutoImageImport: true, normalSaveImageImport: mode === "manual", preserveDirtyShotLayers: mode === "preserve" })).rejects.toThrow();
  expect(await Promise.all(files.map(p => fs.readFile(p)))).toEqual(bytes);
});
it("automatic ACK then MD failure preserves P2 and actual assets and gates Save autosave History", async () => {
  const f = await autoFixture(), s = f.ref.current.shots[0], oldPng = await fs.readFile(path.join(f.root, s.layers![0].bitmapPath)), md = await fs.readFile(f.mdPath), tiff = await fs.readFile(s.imagePath);
  const controls = await actualErrorAndClose(f);
  f.setFault(); f.beforePersist(async () => { f.adapter.owner.publishEdit(p => ({ ...p, name: "P2" }), []); });
  await f.refresh();
  expect(controls.refs.workspaceSaveStateRef.current).toBe("error"); expect(controls.refs.setSaveErrorDialog).toHaveBeenCalled(); await controls.close(); expect(f.ref.current.name).toBe("P2"); expect(f.ref.current.pendingBake!.shots.s.state).toBe("unknown"); expect(f.recovery.current).toMatch(/Import incomplete/);
  expect(await fs.readFile(path.join(f.root, s.layers![0].bitmapPath))).not.toEqual(oldPng); expect(await fs.readFile(s.imagePath)).toEqual(tiff);
  expect(await fs.readFile(s.swb!.archivePath!)).toEqual(f.original); expect(await fs.readFile(f.mdPath)).toEqual(md);
  expect(JSON.parse(await fs.readFile(f.metadataPath, "utf8")).pendingBake.shots.s.state).toBe("pending");
  const writes = f.writes.length; expect(await f.adapter.save()).toBe(false); expect(await f.adapter.autosave(f.ref.current)).toBe(false); expect(f.writes).toHaveLength(writes); expect(f.api.saveWorkspace).not.toHaveBeenCalled();
  const text = await fs.readFile(new URL("../../src/renderer/projectHistoryController.ts", import.meta.url), "utf8"), tree = ts.createSourceFile("history.ts", text, ts.ScriptTarget.Latest, true); const selected: string[] = [];
  const visit = (n: ts.Node) => { if (ts.isVariableDeclaration(n) && ["requireHistorySafe", "applyHistoryEntry"].includes(n.name.getText(tree))) selected.push(`const ${n.getText(tree)};`); ts.forEachChild(n, visit); }; visit(tree);
  const asset = vi.fn(), bindings = { getRecoveryRequiredMessage: () => f.recovery.current, projectRef: f.ref, setStatus: vi.fn(), isImageImportLocked: () => false, bitmapLayerWriteQueueRef: { current: f.queue }, createHistoryEntry: asset, restoreHistoryLayerAssets: asset };
  const history = new Function(...Object.keys(appCallerAdapterScope(bindings)), ts.transpile(selected.join("\n") + ";return applyHistoryEntry;", { target: ts.ScriptTarget.ES2022 }))(...Object.values(appCallerAdapterScope(bindings)));
  await history("undo"); await history("redo"); expect(asset).not.toHaveBeenCalled();
});
it("automatic admitted Import survives a newer watcher check without releasing unacknowledged effects", async () => {
  const f = await autoFixture(), held = barrier(), entered = barrier(); f.io.mockClear(); const io = f.io.getMockImplementation()!;
  f.io.mockImplementation(async payload => { entered.release(); await held.promise; return io(payload); });
  const first = f.refresh(); await entered.promise; const next = f.refresh(); held.release(); await first; await next;
  expect(f.io).toHaveBeenCalledOnce(); expect(f.ref.current.shots[0].swb!.status).toBe("owned");
  expect(f.ref.current.pendingBake!.shots.s.state).toBe("pending"); expect(f.published).toHaveBeenCalledTimes(2); expect(f.errors).toEqual([]);
});
it.each(["stable", "changed"])("automatic actual scene selectors use latest dialogue and finite dependency refusal: %s", async mode => {
  const f = await autoFixture(), ioEntered = barrier(), ioWait = barrier(), preparing = barrier(), prepWait = barrier(); const io = f.io.getMockImplementation()!;
  const text = await fs.readFile(new URL("../../src/renderer/App.tsx", import.meta.url), "utf8"), tree = ts.createSourceFile("App.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); let expression = "";
  const visit = (n: ts.Node) => { if (ts.isVariableDeclaration(n) && n.name.getText(tree) === "prepareNormalSaveImportMatte") expression = n.initializer!.getText(tree); ts.forEachChild(n, visit); }; visit(tree);
  const bindings = { normalSaveAppAdapterRef: { current: f.adapter }, sceneMatteModeForProject, sceneDialogueOverlayEnabledForProject, prepareImportedImageMatte, window: { storyboard: f.api }, bitmapLayerWriteQueueRef: { current: f.queue }, folderPath: f.root, metadataPath: f.metadataPath, setStatus: vi.fn(), workspaceRecoveryRequiredRef: f.recovery, normalSaveAppCallbacksRef: { current: { onError: vi.fn() } } };
  const prepare = new Function(...Object.keys(appCallerAdapterScope(bindings)), ts.transpile(`return (${expression});`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(appCallerAdapterScope(bindings)));
  f.io.mockImplementation(async payload => { ioEntered.release(); await ioWait.promise; return io(payload); });
  f.hooks.prepare = async (p, ids, current) => { expect(p.dialogues[0].text).toBe("latest P2"); const result = await prepare(p, ids, current); preparing.release(); await prepWait.promise; return result; };
  const task = f.refresh(); await ioEntered.promise; f.adapter.owner.publishEdit(p => ({ ...p, dialogues: [{ id: "d", shotId: "s", text: "latest P2", order: 0 }] }), []); ioWait.release(); await preparing.promise;
  if (mode === "changed") f.adapter.owner.publishEdit(p => ({ ...p, dialogues: [{ ...p.dialogues[0], text: "P3 dependency" }] }), []);
  prepWait.release(); await task;
  if (mode === "stable") { expect(f.errors).toEqual([]); expect(JSON.parse(await fs.readFile(f.metadataPath, "utf8")).dialogues[0].text).toBe("latest P2"); }
  else { expect(f.ref.current.dialogues[0].text).toBe("P3 dependency"); expect(f.ref.current.pendingBake!.shots.s.state).toBe("unknown"); expect(f.recovery.current).toMatch(/Import incomplete/); }
});
it("automatic load read-wait ABA performs no follow-on scan or Import and publishes no old scope", async () => {
  const f = await autoFixture(), ready = barrier(), hold = barrier(), checked = vi.fn(async () => ({ images: [f.image], scriptImportNeeded: false })), publish = vi.fn();
  Object.assign(f.api, { checkExternalChanges: checked }); f.io.mockClear();
  const load = f.adapter.load(async () => { ready.release(); await hold.promise; return { folderPath: f.root, folderName: "A", metadataPath: f.metadataPath, images: [], project: f.ref.current, preserveProjectWithoutImageMerge: true }; }, publish,
    { blankShotPreset: "16:9", dirtyShotIds: [], prepare: async p => p, published: f.published });
  await ready.promise; const b = f.adapter.owner.load({ ...createProject("B"), pendingBake: { version: 1, shots: {} } }); const a = f.adapter.owner.load({ ...createProject("new A"), pendingBake: { version: 1, shots: {} } });
  hold.release(); expect(await load).toBe(false); await b; await a;
  expect(checked).not.toHaveBeenCalled(); expect(f.io).not.toHaveBeenCalled(); expect(publish).not.toHaveBeenCalled(); expect(f.errors).toEqual([]); expect(f.ref.current.name).toBe("new A");
});
async function actualErrorAndClose(f: Awaited<ReturnType<typeof fixture>>) {
  const text = await fs.readFile(new URL("../../src/renderer/App.tsx", import.meta.url), "utf8"), tree = ts.createSourceFile("App.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callbacks = "", close = "";
  const visit = (n: ts.Node) => { if (ts.isVariableDeclaration(n) && n.name.getText(tree) === "normalSaveAppCallbacks") callbacks = n.initializer!.getText(tree); if (ts.isCallExpression(n) && n.expression.getText(tree) === "window.storyboard.onSaveAndCloseRequested") close = n.arguments[0].getText(tree); ts.forEachChild(n, visit); }; visit(tree);
  const refs = { formatSaveFailureStatus: (await import("../../src/renderer/saveErrors")).formatSaveFailureStatus,
    workspaceSaveStateRef: { current: "saved" }, fileNameSyncStateRef: { current: "synced" }, setSaveErrorDialog: vi.fn(), setWorkspaceSaveState: vi.fn(), setFileNameSyncState: vi.fn(), setAutosaveError: vi.fn(), setStatus: vi.fn(), setWorkspaceTask: vi.fn() };
  const handlers = new Function(...Object.keys(refs), ts.transpile(`return (${callbacks});`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(refs));
  f.onError(handlers.onError);
  const finished = barrier(), finishSaveAndClose = vi.fn(async () => { finished.release(); });
  const bindings = { normalSaveAppAdapterRef: { current: f.adapter }, handleSaveProject: () => f.adapter.save(), window: { storyboard: { finishSaveAndClose } }, setStatus: vi.fn() };
  const runClose = new Function(...Object.keys(appCallerAdapterScope(bindings)), ts.transpile(`return (${close});`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(appCallerAdapterScope(bindings)));
  return { refs, close: async () => { runClose({ requestId: "automatic-import-close" }); await finished.promise; expect(finishSaveAndClose).toHaveBeenCalledWith({ requestId: "automatic-import-close", saved: false }); } };
}
it("actual main automatic rechecks TIFF SWB shot identity instead of trusting a compatible payload", async () => {
  const f = await autoFixture(), s = f.ref.current.shots[0], png = path.join(f.root, s.layers![0].bitmapPath), before = await fs.readFile(png);
  const exported = await f.exportProject({ ...f.ref.current, shots: [{ ...s, id: "foreign-shot" }] }, "foreign");
  await fs.copyFile(exported.replacements[0].fromPath, s.imagePath);
  const project = mergeExternalImageChanges(f.ref.current, [f.image]);
  await expect(f.io({ project, folderPath: f.root, metadataPath: f.metadataPath, normalSave: true, normalSaveAutoImageImport: true })).rejects.toThrow(/identity|compatible/);
  expect(await fs.readFile(png)).toEqual(before);
});
async function autoFixture() {
  const f = await fixture("layered"); expect(await f.run()).toBe(true);
  const s = f.ref.current.shots[0];
  f.ref.current = { ...f.ref.current, pendingBake: { version: 1, shots: { s: { state: "synced", acceptedOutputIdentity: await hash(s.imagePath) } } } };
  const externalPng = path.join(f.root, ".storyboard-workbench/layers/external/pixel.png");
  await fs.mkdir(path.dirname(externalPng), { recursive: true });
  await sharp({ create: { width: 4, height: 3, channels: 4, background: "green" } }).png().toFile(externalPng);
  const external = { ...f.ref.current, shots: [{ ...s, layers: s.layers!.map(l => ({ ...l, bitmapPath: path.relative(f.root, externalPng) })) }] };
  const result = await f.exportProject(external, "external");
  await fs.copyFile(result.replacements[0].fromPath, s.imagePath);
  const image = { fileName: s.fileName, imagePath: s.imagePath, width: 4, height: 3, fingerprint: await pixelFingerprint(s.imagePath), swbMetadata: await f.readMetadata(s.imagePath) } as any;
  const checks = vi.fn(async () => ({ images: [image], scriptImportNeeded: false }));
  const hooks = { prepare: async (p: Project, _ids: string[], _current: () => boolean) => p, published: (scan: FolderScanPayload, durable?: boolean) => f.published(scan, durable) };
  const app = await fs.readFile(new URL("../../src/renderer/App.tsx", import.meta.url), "utf8");
  const tree = ts.createSourceFile("App.tsx", app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression = "";
  const visit = (n: ts.Node) => { if (ts.isVariableDeclaration(n) && n.name.getText(tree) === "refreshExternalImportState") expression = n.initializer!.getText(tree); ts.forEachChild(n, visit); }; visit(tree);
  const bindings = { prepareNormalSaveScriptMatte: async (p: Project) => p, normalSaveScriptImportPublished: vi.fn(), normalSaveAppEnabled: true, normalSaveAppAdapterRef: { current: f.adapter }, window: { storyboard: { ...f.api, checkExternalChanges: checks } }, blankShotPreset: "16:9", scriptImportCheckIdRef: { current: 0 }, dirtyShotIds: () => [], folderPathRef: { current: f.root }, metadataPathRef: { current: f.metadataPath }, projectRef: f.ref,
    refreshWorkspaceExternalImportState, mergeExternalImageChanges, hasOnlyCompatibleExternalEdits: (p: Project) => p.shots.some(s => s.swb?.status === "compatible-external-edit") && p.shots.every(s => ["owned", "compatible-external-edit"].includes(s.swb!.status)), loadFolderScan: vi.fn(), projectNeedsSwbImport: () => true, workspaceSaveStateRef: { current: "saved" }, setScriptImportNeeded: vi.fn(), setStatus: vi.fn(), withStatus: async (_: string, task: () => Promise<unknown>) => task(), prepareNormalSaveImportMatte: (p: Project, ids: string[], current: () => boolean) => hooks.prepare(p, ids, current), normalSaveImageImportPublished: (scan: FolderScanPayload, durable?: boolean) => hooks.published(scan, durable), setProject: vi.fn(), refreshChangedShotBitmapRevisions: vi.fn(), persistWorkspace: vi.fn() };
  const refresh = new Function(...Object.keys(appCallerAdapterScope(bindings)), ts.transpile(`return (${expression});`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(appCallerAdapterScope(bindings)));
  return { ...f, checks, refresh, bindings, image, hooks };
}
it("actual App automatic compatible refresh owns scan Import ACK and required persistence without manual permission", async () => {
  const f = await autoFixture(), before = await hash(f.ref.current.shots[0].imagePath); f.io.mockClear();
  const imported = f.io.getMockImplementation()!;
  f.io.mockImplementation(payload => { expect(payload).toMatchObject({ normalSave: true, normalSaveAutoImageImport: true }); return imported(payload); });
  await f.refresh();
  expect(f.io).toHaveBeenCalledWith(expect.objectContaining({ normalSave: true, normalSaveAutoImageImport: true }));
  expect(f.io.mock.calls[0][0].normalSaveImageImport).toBeUndefined();
  expect(f.errors).toEqual([]); expect(f.ref.current.shots[0].swb!.status).toBe("owned");
  expect(await hash(f.ref.current.shots[0].imagePath)).toBe(before);
  expect(f.ref.current.pendingBake!.shots.s).toMatchObject({ state: "pending", acceptedOutputIdentity: before });
  expect(JSON.parse(await fs.readFile(f.metadataPath, "utf8"))).toEqual(JSON.parse(JSON.stringify(f.ref.current)));
  expect(await fs.readFile(f.mdPath, "utf8")).toBe(script.serializeStoryboardScriptMarkdown(f.ref.current));
  expect((await sharp(path.join(f.root, f.ref.current.shots[0].layers![0].bitmapPath)).raw().toBuffer())[1]).toBe(128);
});
it("automatic different external layer structure is retained before PNG replacement", async () => {
  const f = await autoFixture(), s = f.ref.current.shots[0];
  const internal = await fs.readFile(path.join(f.root, s.layers![0].bitmapPath));
  const changed = { ...f.ref.current, shots: [{ ...s, layers: [{ ...s.layers![0], name: "different external layer" }] }] };
  const exported = await f.exportProject(changed, "different");
  await fs.copyFile(exported.replacements[0].fromPath, s.imagePath);
  const original = await fs.readFile(s.imagePath), json = await fs.readFile(f.metadataPath);
  f.image.fingerprint = await pixelFingerprint(s.imagePath); f.io.mockClear();
  await f.refresh();
  expect(await fs.readFile(path.join(f.root, s.layers![0].bitmapPath))).toEqual(internal);
  expect(await fs.readFile(s.imagePath)).toEqual(original); expect(await fs.readFile(f.metadataPath)).toEqual(json);
  expect(f.errors).toHaveLength(1); expect(f.published).toHaveBeenCalledTimes(1); // only prior manual Import
});
it("automatic flattened unchanged scan still detects whole TIFF byte conflict and does not Import", async () => {
  const f = await autoFixture(), originalShot = f.ref.current.shots[0], flattened = await pixelFingerprint(originalShot.imagePath);
  f.ref.current = { ...f.ref.current, shots: [{ ...originalShot, swb: { ...originalShot.swb!, baseFingerprint: flattened } }], pendingBake: { version: 1, shots: { s: { state: "synced", acceptedOutputIdentity: await hash(originalShot.imagePath) } } } };
  const hiddenPng = ".storyboard-workbench/layers/external/hidden.png";
  await sharp({ create: { width: 4, height: 3, channels: 4, background: "red" } }).png().toFile(path.join(f.root, hiddenPng));
  const occluded = { ...f.ref.current, shots: [{ ...originalShot, layers: originalShot.layers!.map((l, i) => ({ ...l, bitmapPath: i ? ".storyboard-workbench/layers/external/pixel.png" : hiddenPng })) }] };
  const output = await f.exportProject(occluded, "occluded");
  await fs.copyFile(output.replacements[0].fromPath, originalShot.imagePath);
  expect(await pixelFingerprint(originalShot.imagePath)).toBe(flattened);
  expect(await hash(originalShot.imagePath)).not.toBe(f.ref.current.pendingBake!.shots.s.acceptedOutputIdentity);
  f.image.fingerprint = flattened; f.io.mockClear();
  const s = f.ref.current.shots[0], tiff = await fs.readFile(s.imagePath), png = await fs.readFile(path.join(f.root, s.layers![0].bitmapPath));
  await f.refresh();
  expect(f.io).not.toHaveBeenCalled(); expect(f.ref.current.pendingBake!.shots.s.state).toBe("unknown");
  expect(await fs.readFile(s.imagePath)).toEqual(tiff); expect(await fs.readFile(path.join(f.root, s.layers![0].bitmapPath))).toEqual(png);
  expect(f.errors).toHaveLength(1);
});
it("automatic load reader waits old I/O and imports inside owned load without recursive queue", async () => {
  const f = await autoFixture(), s = f.ref.current.shots[0]; f.io.mockClear();
  let release!: () => void; const hold = new Promise<void>(r => release = r);
  const old = f.queue.runExclusive(() => hold), reader = vi.fn(async () => ({ folderPath: f.root, folderName: "Synthetic", metadataPath: f.metadataPath, images: [f.image], project: mergeExternalImageChanges(f.ref.current, [f.image]) }));
  const load = f.adapter.load(reader, () => {}, { blankShotPreset: "16:9", dirtyShotIds: [], prepare: async (p: Project) => p, published: f.published });
  await Promise.resolve(); expect(reader).not.toHaveBeenCalled(); release(); await old;
  expect(await load).toBe(true); expect(f.io).toHaveBeenCalledOnce();
  expect(f.ref.current.pendingBake!.shots.s).toMatchObject({ state: "pending", acceptedOutputIdentity: await hash(s.imagePath) });
});
it.each(["A-to-B", "first-open", "rollback", "recovery"])("owned load actual App open and prepare bind operation B not old render: %s", async scenario => {
  const a = await autoFixture(), b = await autoFixture();
  const aLayer = a.ref.current.shots[0].layers![0], bLayer = b.ref.current.shots[0].layers![0];
  expect(aLayer.bitmapPath).toBe(bLayer.bitmapPath);
  await sharp({ create: { width: 4, height: 3, channels: 4, background: "yellow" } }).png().toFile(path.join(a.root, aLayer.bitmapPath));
  expect(await fs.readFile(path.join(a.root, aLayer.bitmapPath))).not.toEqual(await fs.readFile(path.join(b.root, bLayer.bitmapPath)));
  const protectedPaths = [a.metadataPath, a.mdPath, ...a.ref.current.shots[0].layers!.map(l => path.join(a.root, l.bitmapPath))];
  const before = await Promise.all(protectedPaths.map(p => fs.readFile(p)));
  const paths = { folderPath: scenario === "first-open" ? undefined : a.root, metadataPath: scenario === "first-open" ? undefined : a.metadataPath };
  const ref = { current: a.ref.current }, queue = createBitmapLayerWriteQueue(), errors: unknown[] = [];
  const writesTo: string[] = [], deletesFrom: string[] = []; let writeNumber = 0;
  const api = { ...b.api, checkExternalChanges: b.checks,
    writeLayerPng: async (payload: Parameters<typeof layer.writeLayerPng>[0]) => {
      writesTo.push(payload.folderPath); writeNumber++;
      if (["rollback", "recovery"].includes(scenario) && writeNumber === 2 || scenario === "recovery" && writeNumber > 2) throw new Error("injected B PNG write failure");
      return layer.writeLayerPng(payload);
    }, deleteLayerPng: async (payload: Parameters<typeof layer.deleteLayerPng>[0]) => { deletesFrom.push(payload.folderPath); return layer.deleteLayerPng(payload); } };
  const caller = await createAppOpenCallerScope({ projectRef: ref, setProject: () => {}, queue, freshToken: () => "load-fresh", paths: () => scenario === "first-open" ? { folderPath: b.root, metadataPath: b.metadataPath } : paths, api: () => api, onSave: () => {}, onError: e => errors.push(e) }, scenario !== "first-open", true);
  const app = await fs.readFile(new URL("../../src/renderer/App.tsx", import.meta.url), "utf8"), tree = ts.createSourceFile("App.tsx", app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = ["prepareNormalSaveImportMatte", "publishNormalSaveFolderScan", "handleOpenFolderByPath"], selected: string[] = [];
  const walk = (n: ts.Node) => { if (ts.isVariableDeclaration(n) && names.includes(n.name.getText(tree))) selected.push(`const ${n.getText(tree)};`); ts.forEachChild(n, walk); }; walk(tree);
  const url = (buffer: Buffer) => `data:image/png;base64,${buffer.toString("base64")}`;
  const overlay = url(await sharp({ create: { width: 4, height: 153, channels: 4, background: "transparent" } }).png().toBuffer());
  const canvas = { expandBitmapLayer: async (value: string, _l: unknown, top: number, bottom: number) => url(await sharp(Buffer.from(value.split(",")[1], "base64")).extend({ top, bottom, left: 0, right: 0, background: "transparent" }).png().toBuffer()), createMatteOverlay: () => overlay, createDialogueOverlay: () => overlay };
  const bindings = { ...caller, normalSaveAppEnabled: true, projectRef: ref,
    folderPath: paths.folderPath, metadataPath: paths.metadataPath, folderInputValue: b.root,
    sceneMatteModeForProject: () => "expanded", sceneDialogueOverlayEnabledForProject: () => true,
    prepareImportedImageMatte: (p: Project, mode: "expanded", ids: string[], request: any, deps: any) => prepareImportedImageMatte(p, mode, ids, request, { ...deps, canvas }),
    window: { storyboard: { ...api, openFolderByPath: async (_path: string, options: unknown) => { expect(options).toEqual({ normalSave: true, initializePreviews: true }); return { folderPath: b.root, metadataPath: b.metadataPath, folderName: "B", project: b.ref.current, images: [], preserveProjectWithoutImageMerge: true }; } } },
    bitmapLayerWriteQueueRef: { current: queue }, blankShotPreset: "16:9", normalSaveImageImportPublished: vi.fn(),
    workspaceRecoveryRequiredRef: caller.operationRecoveryRef, normalSaveAppCallbacksRef: { current: { onError: vi.fn() } },
    aiApplyWorkspaceIdentityRef: { current: {} }, scriptImportCheckIdRef: { current: 0 }, pendingBakeForProject,
    workspaceSaveStateRef: { current: "saved" }, fileNameSyncStateRef: { current: "synced" },
    folderPathRef: { get current() { return paths.folderPath; }, set current(v: string | undefined) { paths.folderPath = v; } }, metadataPathRef: { get current() { return paths.metadataPath; }, set current(v: string | undefined) { paths.metadataPath = v; } },
    setStatus: vi.fn(), setWorkspaceTask: vi.fn(), setWorkspaceSaveState: vi.fn(), setFileNameSyncState: vi.fn(), setScriptImportNeeded: vi.fn(), resetHistoryStacks: vi.fn(), selectSingleShot: vi.fn(), resetTrackedDirtyShots: vi.fn(), setFolderPath: vi.fn(), setFolderInputValue: vi.fn(), setMetadataPath: vi.fn(), setShotBitmapRevisionById: vi.fn(), bumpWorkspaceShotBitmapRevisions: vi.fn() };
  await new Function(...Object.keys(appCallerAdapterScope(bindings)), ts.transpile(selected.join("\n") + ";return handleOpenFolderByPath;", { target: ts.ScriptTarget.ES2022 }))(...Object.values(appCallerAdapterScope(bindings)))();
  expect(writesTo.length).toBeGreaterThan(0); expect(writesTo.every(root => root === b.root)).toBe(true); expect(deletesFrom.every(root => root === b.root)).toBe(true);
  expect(await Promise.all(protectedPaths.map(p => fs.readFile(p)))).toEqual(before);
  if (["rollback", "recovery"].includes(scenario)) {
    expect(errors).toHaveLength(1); expect(ref.current.pendingBake!.shots.s.state).toBe("unknown");
    if (scenario === "rollback") for (const l of b.ref.current.shots[0].layers!) expect((await sharp(path.join(b.root, l.bitmapPath)).metadata()).height).toBe(3);
    else expect(bindings.workspaceRecoveryRequiredRef.current).toMatch(/rollback also failed/);
    return;
  }
  expect(errors).toEqual([]); expect(ref.current.shots[0].presentation?.matte?.mode).toBe("expanded");
  const shot = ref.current.shots[0]; expect(shot.layers!.some(l => l.id === dialogueOverlayBitmapLayerId)).toBe(true);
  for (const l of shot.layers!) expect((await sharp(path.join(b.root, l.bitmapPath)).metadata()).height).toBe(153);
  const centralPixel = await sharp(path.join(b.root, shot.layers![0].bitmapPath)).extract({ left: 0, top: 75, width: 1, height: 1 }).raw().toBuffer();
  expect([...centralPixel]).toEqual([0, 128, 0, 255]);
  expect(JSON.parse(await fs.readFile(b.metadataPath, "utf8"))).toEqual(JSON.parse(JSON.stringify(ref.current)));
  expect(await fs.readFile(b.mdPath, "utf8")).toBe(script.serializeStoryboardScriptMarkdown(ref.current));
});

async function fixture(kind: "png" | "tiff" | "layered" = "png") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "manual-import-chain-")); dirs.push(root);
  const imagePath = path.join(root, kind === "png" ? "a.png" : "a.tiff");
  await sharp({ create: { width: 4, height: 3, channels: 4, background: "red" } }).toFile(imagePath);
  const scanned = addImportedImages(createProject("Synthetic"), [{ imagePath, fileName: path.basename(imagePath), width: 4, height: 3 }]).shots[0];
  let p: Project = { ...createProject("Synthetic"), shots: [{ ...scanned, id: "s", layers: undefined, order: 0 }], pendingBake: { version: 1, shots: {} } };
  if (kind === "layered") {
    const layers = await Promise.all(["red", "blue"].map(async (color, i) => {
      const bitmapPath = `.storyboard-workbench/layers/fixture/${i}.png`; await fs.mkdir(path.dirname(path.join(root, bitmapPath)), { recursive: true });
      await sharp({ create: { width: 4, height: 3, channels: 4, background: color } }).png().toFile(path.join(root, bitmapPath));
      return { id: `l${i}`, kind: i === 0 ? "image" as const : "paint" as const, name: color, bitmapPath, width: 4, height: 3, visible: true, locked: false, order: i, opacity: 1, blendMode: "normal" as const };
    }));
    const exportProject = { ...p, shots: [{ ...p.shots[0], layers }] };
    const exported = await writePhotoshopLayeredTiffsForInPlaceSave(exportProject, root, { scriptPath: path.join(process.cwd(), "scripts/photoshop-layered-tiff-export.py"), saveStamp: "source", env: process.env });
    await fs.copyFile(exported.replacements[0].fromPath, imagePath);
  }
  // Real scan/load normalization supplies Image metadata before any internal PNG exists.
  p = { ...p, shots: p.shots.map(s => ensureBitmapLayerMetadata(s)) };
  const original = await fs.readFile(imagePath), metadataPath = path.join(root, ".storyboard-workbench/storyboard.project.json"), mdPath = path.join(root, script.storyboardScriptFileName);
  const recovery = { current: undefined as string | undefined };
  let fault = false, beforePersist: (() => Promise<void>) | undefined;
  let scriptLayerFault = false, scriptRollbackFault = false, earlyPreviewFault = false;
  let afterJson: (() => Promise<void>) | undefined;
  let blankCount = 0, secondBlankFault = false, cleanupGate: ReturnType<typeof barrier> | undefined;
  const cleanupStarted = vi.fn(), cleanupSettled = vi.fn();
  const writes: Project[] = [], errors: unknown[] = [];
  let errorSubscriber: (e: unknown) => void = () => {};
  let handler!: (e: unknown, p: ImportSwbFormatPayload) => Promise<FolderScanPayload>;
  const bindings = { ...fs, ...renames, ...importPorts, ...bitmap, ...safety, ...layer, ...script, ...tiffPreparation,
    removeOwnedFile: (receipt: OwnedFileReceipt): Promise<void> => removeOwnedFile(receipt, bindings.unlink),
    path, sharp, createHash, randomUUID, createBlankShot: async (...args: Parameters<typeof createBlankShot>) => {
      if (secondBlankFault && ++blankCount === 2) throw new Error("second blank creation failed");
      return createBlankShot(...args);
    }, createImportedImageRecords: async (...args: Parameters<typeof createImportedImageRecords>) => {
      if (earlyPreviewFault && args[0].some(p => path.basename(p).startsWith("new_shot_"))) throw new Error("early blank preview failure");
      return createImportedImageRecords(...args);
    }, ImportRecoveryIncompleteError, normalSaveImportFailure, automaticImageImportAdmission, manualImageImportAdmission, bitmapLayersForShot, pixelFingerprint,
    createImportPathReservation, prepareImportStaging, recoverFailedImport, withSuccessfulSaveArtifactCleanup, previewRootForFolder,
    createPreview: (image: string, previewRoot: string, readOnly?: boolean, onReceipt?: Parameters<typeof createPreview>[3]) =>
      createPreview(image, previewRoot, readOnly, onReceipt ? receipt => {
        const rollback = receipt.rollback;
        receipt.rollback = async () => {
          if (cleanupGate) { cleanupStarted(); await cleanupGate.promise; }
          await rollback();
          if (cleanupGate) cleanupSettled();
        };
        onReceipt(receipt);
      } : undefined),
    writePhotoshopLayeredTiffsForInPlaceSave, hasPendingFileTransaction, prepareProtectedLayerReplacement,
    app: { getAppPath: () => process.cwd() }, process, withLayerFileOperation, mapWithConcurrency,
    resolvePhotoshopTiffPythonDepsDir: () => process.env.SWB_PYTHON_DEPS_DIR,
    // Filesystem refusal injection moved with the public storage boundary;
    // every non-fault call executes the real native protected writer.
    writeProtectedLayerFile: async (...args: Parameters<typeof protectedWriter>) => {
      const directory = path.dirname(args[1]);
      if (scriptLayerFault && directory.includes("/layers/") && !directory.endsWith("/layers/s")) throw new Error("script blank internal PNG prepare failed");
      return protectedWriter(...args);
    },
    createWorkspaceTaskProgressReporter: () => undefined,
    ipcMain: { handle: (_name: string, fn: typeof handler) => { handler = fn; } },
    rename: async (...args: Parameters<typeof fs.rename>) => { await fs.rename(...args); if (args[1] === metadataPath) await afterJson?.(); },
    mkdir: async (...args: Parameters<typeof fs.mkdir>) => {
      if (scriptLayerFault && String(args[0]).includes("/layers/") && !String(args[0]).endsWith("/layers/s")) throw new Error("script blank internal PNG prepare failed");
      return fs.mkdir(...args);
    },
    unlink: async (...args: Parameters<typeof fs.unlink>) => {
      if (scriptRollbackFault && path.basename(String(args[0])).startsWith("new_shot_")) { const error = new Error("script blank rollback EPERM") as NodeJS.ErrnoException; error.code = "EPERM"; throw error; }
      if (cleanupGate && String(args[0]).includes("/previews/")) { cleanupStarted(); await cleanupGate.promise; await fs.unlink(...args); cleanupSettled(); return; }
      return fs.unlink(...args);
    },
    writeFile: async (...args: Parameters<typeof fs.writeFile>) => { if (args[0] === mdPath && fault) throw new Error("required MD failed after JSON"); await fs.writeFile(...args); }
  };
  const names = ["sharpSourceOptions", "swbFormatVersion", "swbXmpTag", "readSwbMetadata", "archiveStamp", "uniquePath", "projectNeedsSwbImport", "assertNormalSaveAdmission", "importStoryboardScriptMarkdown", "createGeneratedShotFromImage", "createImageRecords", "assertManualImageImportAdmission", "importProjectToSwbFormat", "emptyDefaultSketchLayers", "createProjectPreviewsForShots", "ensureProjectLayerAssets", "createImageBitmapLayerPng", "createPaintBitmapLayerPng", "createTransparentLayerPng", "transparentLayerBuffer", "shouldWriteSwbMetadata", "shouldWritePhotoshopLayeredTiffOnSave", "bakeShotToWorkingTiff", "bakeBitmapLayersToTiff", "bakeSketchOverlayToTiff", "sketchLayersForShot", "swbMetadataForShot", "swbMetadataXmp", "writeSwbMetadataToTiffs", "preparePhotoshopLayeredTiffsForSave", "writeProjectFiles", "writeProjectMetadata", "writeStoryboardScriptMarkdown", "storyboardScriptPathForFolder"];
  const tree = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
  const selected = tree.statements.filter(n => ts.isVariableStatement(n) && names.includes(n.declarationList.declarations[0].name.getText(tree)));
  expect(selected).toHaveLength(names.length);
  const block = source.slice(source.indexOf('  ipcMain.handle("workspace:importSwbFormat"'), source.indexOf("  registerWorkspaceExternalChangesIpcHandlers("));
  const compiled = ts.transpileModule(selected.map(n => n.getText(tree)).join("\n") + block + "; return { persist: writeProjectFiles, ensure: ensureProjectLayerAssets, admit: assertNormalSaveAdmission, readMetadata: readSwbMetadata, exportProject: preparePhotoshopLayeredTiffsForSave };", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const chain = new Function("isCertifiedPendingBakeEntry", ...Object.keys(bindings).filter(k => k !== "default"), compiled)(isCertifiedPendingBakeEntry, ...Object.entries(bindings).filter(([k]) => k !== "default").map(([, v]) => v));
  const autosaveHandlers: Record<string, (event: unknown, payload: ImportSwbFormatPayload) => Promise<unknown>> = {};
  registerWorkspacePersistenceIpcHandlers({ handle: (name: string, fn: (event: unknown, payload: ImportSwbFormatPayload) => Promise<unknown>) => { autosaveHandlers[name] = fn; } }, {
    // Actual admission + writer/ensure bodies, not a substitute success port.
    assertAdmission: payload => payload.normalSave ? chain.admit(payload, false) : undefined,
    ensureProjectLayerAssets: (project, folderPath, options) => chain.ensure(project, folderPath, options),
    writeProjectFiles: (metadataPath, folderPath, project, input, expected) => chain.persist(metadataPath, folderPath, project, input, expected)
  });
  const ref = { current: p }, queue = createBitmapLayerWriteQueue(), published = vi.fn();
  const io = vi.fn((payload: ImportSwbFormatPayload) => handler({ sender: {} }, payload));
  const api = { importSwbFormat: io, readOutputIdentity: hash,
    ensureLayerAssets: async (payload: { project: Project; folderPath: string }) => { await chain.ensure(payload.project, payload.folderPath); return payload; },
    readLayerPng: layer.readLayerPng, writeLayerPng: layer.writeLayerPng, deleteLayerPng: layer.deleteLayerPng,
    saveWorkspace: vi.fn(async () => { throw new Error("not part of Import fixture"); }),
    autosaveWorkspace: async (payload: import("../../src/shared/types").WorkspacePayload) => { writes.push(payload.project); await beforePersist?.(); await autosaveHandlers["workspace:autosave"](undefined, payload); return payload; }
  };
  const adapter = await createAppRootActor({ projectRef: ref, setProject: () => {}, queue, freshToken: () => "fresh", paths: () => ({ folderPath: root, metadataPath }),
    api: () => api, assertImportAdmission: () => { if (recovery.current) throw new Error(recovery.current); }, assertAdmission: () => { if (recovery.current) throw new Error(recovery.current); }, onImportRecoveryRequired: message => { recovery.current = message; }, onSave: () => {}, onError: e => { errors.push(e); errorSubscriber(e); } });
  const run = async (extra: Partial<Parameters<typeof adapter.imageImport>[0]> = {}) => {
    const text = await fs.readFile(new URL("../../src/renderer/App.tsx", import.meta.url), "utf8");
    const tree = ts.createSourceFile("App.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let expression = "";
    const visit = (n: ts.Node) => { if (ts.isVariableDeclaration(n) && n.name.getText(tree) === "handleImportSwbFormat") expression = n.initializer!.getText(tree); ts.forEachChild(n, visit); }; visit(tree);
    const bindings = { window: { storyboard: api }, normalSaveAppEnabled: true, normalSaveAppAdapterRef: { current: adapter },
      folderPath: root, metadataPath, project: ref.current, needsSwbImport: true, needsImageImport: ref.current.shots.some(s => s.swb?.status !== "owned"), scriptImportNeeded: true, blankShotPreset: "16:9", dirtyShotIds: () => [],
      prepareNormalSaveScriptMatte: extra.scriptPrepare ?? (async (p: Project) => p), normalSaveScriptImportPublished: extra.scriptPublished ?? vi.fn(),
      setWorkspaceTask: vi.fn(), setIsImportHelpOpen: () => {}, setStatus: () => {}, prepareNormalSaveImportMatte: extra.prepare ?? (async (p: Project) => p), normalSaveImageImportPublished: extra.published ?? published };
    return new Function(...Object.keys(appCallerAdapterScope(bindings)), ts.transpile(`return (${expression});`))(...Object.values(appCallerAdapterScope(bindings)))();
  };
  return { exportProject: (project: Project, stamp: string) => chain.exportProject(project, root, stamp) as ReturnType<typeof writePhotoshopLayeredTiffsForInPlaceSave>, readMetadata: chain.readMetadata as (p: string) => Promise<import("../../src/shared/types").SwbImageMetadata | undefined>, root, ref, io, api, adapter, queue, recovery, run, original, imagePath, metadataPath, mdPath, published, writes, errors, cleanupStarted, cleanupSettled, setSecondBlankFault: (gate: ReturnType<typeof barrier>) => { secondBlankFault = true; scriptRollbackFault = true; cleanupGate = gate; }, afterJson: (fn: () => Promise<void>) => { afterJson = fn; }, setEarlyPreviewFault: (rollback = false) => { earlyPreviewFault = true; scriptRollbackFault = rollback; }, clearEarlyPreviewFault: () => { earlyPreviewFault = false; }, setFault: () => { fault = true; }, setScriptLayerFault: (rollback = false) => { scriptLayerFault = true; scriptRollbackFault = rollback; }, beforePersist: (f: () => Promise<void>) => { beforePersist = f; }, onError: (fn: (e: unknown) => void) => { errorSubscriber = fn; } };
}
it.each(["png", "tiff", "layered"] as const)("actual main manual %s Import ACK establishes only completed H0 and required JSON/MD", async kind => {
  const f = await fixture(kind); const result = await f.run(); expect(f.errors).toEqual([]); expect(result).toBe(true);
  const shot = f.ref.current.shots[0]; expect(shot.swb!.status).toBe("owned");
  expect(f.ref.current.pendingBake!.shots.s).toEqual({ state: "pending", editToken: "fresh", acceptedOutputIdentity: await hash(shot.imagePath) });
  expect(await fs.readFile(shot.swb!.archivePath!)).toEqual(f.original);
  expect(JSON.parse(await fs.readFile(f.metadataPath, "utf8"))).toEqual(JSON.parse(JSON.stringify(f.ref.current)));
  expect(await fs.readFile(f.mdPath, "utf8")).toBe(script.serializeStoryboardScriptMarkdown(f.ref.current));
  expect(shot.layers!.length).toBeGreaterThan(0);
  for (const l of shot.layers!) expect((await sharp(path.join(f.root, l.bitmapPath)).metadata()).width).toBe(4);
  if (kind === "layered") expect(shot.layers).toHaveLength(2);
});
it("actual required MD filesystem failure after JSON denies Import UI completion", async () => {
  const f = await fixture(); f.setFault(); expect(await f.run()).toBe(false);
  expect(JSON.parse(await fs.readFile(f.metadataPath, "utf8")).pendingBake.shots.s.state).toBe("pending");
  expect(f.published).not.toHaveBeenCalled(); expect(f.errors).toHaveLength(1); expect(f.ref.current.shots[0].imagePath).not.toBe(f.imagePath);
  expect(f.ref.current.pendingBake!.shots.s.state).toBe("unknown");
  expect(await f.adapter.save()).toBe(false);
  expect(await f.adapter.autosave(f.ref.current)).toBe(false);
});
it("actual main unknown future raw admission leaves source and metadata byte untouched", async () => {
  const f = await fixture(); f.ref.current.pendingBake = { version: 9, shots: {} } as unknown as Project["pendingBake"];
  await fs.mkdir(path.dirname(f.metadataPath), { recursive: true }); await fs.writeFile(f.metadataPath, "raw-sentinel");
  await expect(f.io({ project: f.ref.current, folderPath: f.root, metadataPath: f.metadataPath, normalSave: true, normalSaveImageImport: true })).rejects.toThrow(/unknown/);
  expect(await fs.readFile(f.imagePath)).toEqual(f.original); expect(await fs.readFile(f.metadataPath, "utf8")).toBe("raw-sentinel");
});

it("actual main pending compatible external Import duplicates even without legacy dirty tracker", async () => {
  const f = await fixture("layered"); expect(await f.run()).toBe(true);
  const before = f.ref.current.shots[0], pngs = await Promise.all(before.layers!.map(l => fs.readFile(path.join(f.root, l.bitmapPath))));
  f.ref.current = { ...f.ref.current, shots: [{ ...before, swb: { ...before.swb!, status: "compatible-external-edit" } }] };
  const scan = await f.io({ project: f.ref.current, folderPath: f.root, metadataPath: f.metadataPath, normalSave: true, normalSaveImageImport: true, dirtyShotIds: [] });
  expect(scan.project!.shots).toHaveLength(2); expect(scan.normalSaveImportEffects![0].shotId).not.toBe("s");
  expect(await Promise.all(before.layers!.map(l => fs.readFile(path.join(f.root, l.bitmapPath))))).toEqual(pngs);
});
it("actual main explicit preserve policy preserves internal PNGs and returns only preserved effect", async () => {
  const f = await fixture("layered"); expect(await f.run()).toBe(true);
  const before = f.ref.current.shots[0], pngs = await Promise.all(before.layers!.map(l => fs.readFile(path.join(f.root, l.bitmapPath))));
  f.ref.current = { ...f.ref.current, shots: [{ ...before, swb: { ...before.swb!, status: "compatible-external-edit" } }] };
  const scan = await f.io({ project: f.ref.current, folderPath: f.root, metadataPath: f.metadataPath, normalSave: true, normalSaveImageImport: true, dirtyShotIds: ["s"], preserveDirtyShotLayers: true });
  expect(scan.project!.shots).toHaveLength(1); expect(scan.normalSaveImportEffects![0].kind).toBe("preserved");
  expect(await Promise.all(before.layers!.map(l => fs.readFile(path.join(f.root, l.bitmapPath))))).toEqual(pngs);
});
it("actual main rejects changed owned source and missing PNG before writing any Import metadata", async () => {
  const f = await fixture("layered"); expect(await f.run()).toBe(true); const before = await fs.readFile(f.metadataPath);
  const shot = f.ref.current.shots[0]; await fs.appendFile(shot.imagePath, "external bytes");
  await expect(f.io({ project: f.ref.current, folderPath: f.root, metadataPath: f.metadataPath, normalSave: true, normalSaveImageImport: true })).rejects.toThrow(/changed/);
  expect(await fs.readFile(f.metadataPath)).toEqual(before);
  f.ref.current.pendingBake!.shots.s.acceptedOutputIdentity = await hash(shot.imagePath);
  await fs.unlink(path.join(f.root, shot.layers![0].bitmapPath));
  await expect(f.io({ project: f.ref.current, folderPath: f.root, metadataPath: f.metadataPath, normalSave: true, normalSaveImageImport: true })).rejects.toThrow();
  expect(await fs.readFile(f.metadataPath)).toEqual(before);
});

it("actual App matte preparation holds Import queue without re-entry, real PNG changes remain fresh pending H0", async () => {
  const f = await fixture("layered");
  const text = await fs.readFile(new URL("../../src/renderer/App.tsx", import.meta.url), "utf8");
  const tree = ts.createSourceFile("App.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); let expression = "";
  const visit = (n: ts.Node) => { if (ts.isVariableDeclaration(n) && n.name.getText(tree) === "prepareNormalSaveImportMatte") expression = n.initializer!.getText(tree); ts.forEachChild(n, visit); }; visit(tree);
  const dataUrl = (b: Buffer) => `data:image/png;base64,${b.toString("base64")}`;
  const raster = dataUrl(await sharp({ create: { width: 4, height: 153, channels: 4, background: "transparent" } }).png().toBuffer());
  const scopedPrepare: typeof prepareImportedImageMatte = (p, mode, ids, request, deps) => prepareImportedImageMatte(p, mode, ids, request, { ...deps, canvas: {
    expandBitmapLayer: async (url, _layer, top, bottom) => dataUrl(await sharp(Buffer.from(url.split(",")[1], "base64")).extend({ top, bottom, left: 0, right: 0, background: "transparent" }).png().toBuffer()),
    createMatteOverlay: () => raster, createDialogueOverlay: () => raster
  } });
  const bindings = { sceneMatteModeForProject: () => "expanded", sceneDialogueOverlayEnabledForProject: () => false,
    workspaceRecoveryRequiredRef: { current: undefined }, normalSaveAppCallbacksRef: { current: { onError: vi.fn() } },
    prepareImportedImageMatte: scopedPrepare, normalSaveAppAdapterRef: { current: f.adapter }, folderPath: f.root, metadataPath: f.metadataPath,
    window: { storyboard: f.api }, bitmapLayerWriteQueueRef: { current: f.queue }, setStatus: () => {} };
  const prepare = new Function(...Object.keys(appCallerAdapterScope(bindings)), ts.transpile(`return (${expression});`))(...Object.values(appCallerAdapterScope(bindings)));
  expect(await f.run({ prepare })).toBe(true);
  const shot = f.ref.current.shots[0]; expect(shot.presentation!.matte!.mode).toBe("expanded"); expect(shot.swb!.canvasHeight).toBe(153);
  expect((await sharp(shot.imagePath).metadata()).height).toBe(3);
  for (const l of shot.layers!) expect((await sharp(path.join(f.root, l.bitmapPath)).metadata()).height).toBe(153);
  expect(f.ref.current.pendingBake!.shots.s).toMatchObject({ state: "pending", editToken: "fresh", acceptedOutputIdentity: await hash(shot.imagePath) });
  expect(JSON.parse(await fs.readFile(f.metadataPath, "utf8")).shots[0].swb.canvasHeight).toBe(153);
});
it("actual JSON/MD late P2 persistence is latest before Import publication and queue release", async () => {
  const f = await fixture(); let entered!: () => void, release!: () => void;
  const ready = new Promise<void>(r => entered = r), gate = new Promise<void>(r => release = r); let first = true;
  f.beforePersist(async () => { if (first) { first = false; entered(); await gate; } });
  const task = f.run(); await ready;
  f.adapter.owner.publishEdit(p => ({ ...p, name: "P2-real" }), []); let released = false;
  const next = f.queue.runExclusive(async () => { released = true; }); expect(released).toBe(false); expect(f.published).not.toHaveBeenCalled();
  release(); expect(await task).toBe(true); await next;
  expect(f.writes).toHaveLength(2); expect(JSON.parse(await fs.readFile(f.metadataPath, "utf8")).name).toBe("P2-real");
  expect(await fs.readFile(f.mdPath, "utf8")).toBe(script.serializeStoryboardScriptMarkdown(f.ref.current));
});

it("actual default Image metadata with an existing internal PNG is not pristine", async () => {
  const f = await fixture("png"); const file = path.join(f.root, f.ref.current.shots[0].layers![0].bitmapPath);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const edited = await sharp({ create: { width: 4, height: 3, channels: 4, background: "blue" } }).png().toBuffer();
  await fs.writeFile(file, edited);
  await expect(f.io({ project: f.ref.current, folderPath: f.root, metadataPath: f.metadataPath, normalSave: true, normalSaveImageImport: true })).rejects.toThrow(/internal PNG/);
  expect(await fs.readFile(file)).toEqual(edited); expect(await fs.readFile(f.imagePath)).toEqual(f.original);
  await expect(fs.stat(f.metadataPath)).rejects.toMatchObject({ code: "ENOENT" });
});

it.each(["stable", "dialogue", "scene"] as const)("actual original scene dialogue-on with fresh scanned image: %s dependency and real PNG", async change => {
  const f = await fixture("png"); expect(await f.run()).toBe(true);
  const dataUrl = (b: Buffer) => `data:image/png;base64,${b.toString("base64")}`;
  let injecting = false;
  const canvas = {
    expandBitmapLayer: async (url: string, _layer: unknown, top: number, bottom: number) => {
      if (injecting && change !== "stable") {
        injecting = false;
        f.adapter.owner.publishEdit(p => change === "dialogue" ? { ...p, dialogues: [{ id: "P2-dialogue", shotId: p.shots[0].id, text: "P2-current", order: 0 }] } : { ...p, shots: p.shots.map((s, i) => i ? s : { ...s, presentation: undefined }) }, []);
      }
      return dataUrl(await sharp(Buffer.from(url.split(",")[1], "base64")).extend({ top, bottom, left: 0, right: 0, background: "transparent" }).png().toBuffer());
    },
    createMatteOverlay: () => "", createDialogueOverlay: () => ""
  };
  const matte = dataUrl(await sharp({ create: { width: 4, height: 153, channels: 4, background: "transparent" } }).png().toBuffer());
  const dialogue = dataUrl(await sharp({ create: { width: 4, height: 153, channels: 4, background: "green" } }).png().toBuffer());
  canvas.createMatteOverlay = () => matte; canvas.createDialogueOverlay = () => dialogue;
  f.ref.current = await prepareImportedImageMatte(f.ref.current, "expanded", ["s"], {
    folderPath: f.root, metadataPath: f.metadataPath, isCurrent: () => true, isWorkspaceCurrent: () => true,
    dialogueOverlayEnabled: true, setStatus: () => {}, onRecoveryRequired: () => {}
  }, { api: f.api as unknown as Window["storyboard"], queue: f.queue, canvas });
  expect(sceneDialogueOverlayEnabledForProject(f.ref.current)).toBe(true);
  const fresh = path.join(f.root, "fresh.png"); await sharp({ create: { width: 4, height: 3, channels: 4, background: "blue" } }).png().toFile(fresh);
  const original = await fs.readFile(fresh);
  f.ref.current = addImportedImages(f.ref.current, [{ imagePath: fresh, fileName: "fresh.png", width: 4, height: 3 }]);
  const freshId = f.ref.current.shots.find(s => s.imagePath === fresh)!.id;
  expect(sceneDialogueOverlayEnabledForProject(f.ref.current)).toBe(false);
  const text = await fs.readFile(new URL("../../src/renderer/App.tsx", import.meta.url), "utf8");
  const tree = ts.createSourceFile("App.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); let expression = "";
  const visit = (n: ts.Node) => { if (ts.isVariableDeclaration(n) && n.name.getText(tree) === "prepareNormalSaveImportMatte") expression = n.initializer!.getText(tree); ts.forEachChild(n, visit); }; visit(tree);
  const bindings = { sceneMatteModeForProject, sceneDialogueOverlayEnabledForProject,
    prepareImportedImageMatte: (p: Project, mode: "expanded" | "embedded", ids: string[], request: Parameters<typeof prepareImportedImageMatte>[3], deps: Parameters<typeof prepareImportedImageMatte>[4]) => prepareImportedImageMatte(p, mode, ids, request, { ...deps, canvas }),
    normalSaveAppAdapterRef: { current: f.adapter }, folderPath: f.root, metadataPath: f.metadataPath,
    window: { storyboard: f.api }, bitmapLayerWriteQueueRef: { current: f.queue }, setStatus: () => {},
    workspaceRecoveryRequiredRef: { current: undefined }, normalSaveAppCallbacksRef: { current: { onError: vi.fn() } } };
  const prepare = new Function(...Object.keys(appCallerAdapterScope(bindings)), ts.transpile(`return (${expression});`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(appCallerAdapterScope(bindings)));
  injecting = true;
  const completed = await f.run({ prepare });
  if (change !== "stable") {
    expect(completed).toBe(false); expect(f.published).toHaveBeenCalledTimes(1);
    expect(f.ref.current.pendingBake!.shots[freshId].state).toBe("unknown");
    if (change === "dialogue") expect(f.ref.current.dialogues[0].text).toBe("P2-current");
    else expect(f.ref.current.shots[0].presentation).toBeUndefined();
    expect(f.recovery.current).toBeDefined(); return;
  }
  expect(f.errors).toEqual([]); expect(completed).toBe(true);
  const shot = f.ref.current.shots.find(s => s.id === freshId)!;
  const overlay = shot.layers!.find(l => l.id === dialogueOverlayBitmapLayerId)!;
  expect(overlay).toBeDefined(); expect(await fs.readFile(path.join(f.root, overlay.bitmapPath))).toEqual(Buffer.from(dialogue.split(",")[1], "base64"));
  expect(sceneDialogueOverlayEnabledForProject(f.ref.current)).toBe(true);
  expect(await fs.readFile(shot.swb!.archivePath!)).toEqual(original);
});

it.each(["matte", "MD"] as const)("real compatible PNG replacement then %s failure retains asset facts and P2 and gates writers", async failure => {
  const f = await fixture("layered"); expect(await f.run()).toBe(true);
  const before = f.ref.current.shots[0]; const oldJson = await fs.readFile(f.metadataPath), oldMd = await fs.readFile(f.mdPath);
  const oldPng = await fs.readFile(path.join(f.root, before.layers![0].bitmapPath));
  const externalLayers = await Promise.all(before.layers!.map(async (l, i) => {
    const bitmapPath = `.storyboard-workbench/layers/external/l${i}.png`; await fs.mkdir(path.dirname(path.join(f.root, bitmapPath)), { recursive: true });
    await sharp({ create: { width: 4, height: 3, channels: 4, background: i ? "yellow" : "green" } }).png().toFile(path.join(f.root, bitmapPath));
    return { ...l, bitmapPath };
  }));
  const external = await writePhotoshopLayeredTiffsForInPlaceSave({ ...f.ref.current, shots: [{ ...before, layers: externalLayers }] }, f.root, { scriptPath: path.join(process.cwd(), "scripts/photoshop-layered-tiff-export.py"), saveStamp: "external", env: process.env });
  await fs.copyFile(external.replacements[0].fromPath, before.imagePath);
  f.ref.current = { ...f.ref.current, shots: [{ ...before, swb: { ...before.swb!, status: "compatible-external-edit" } }], pendingBake: { version: 1, shots: { s: { state: "synced", acceptedOutputIdentity: f.ref.current.pendingBake!.shots.s.acceptedOutputIdentity } } } };
  const url = (b: Buffer) => `data:image/png;base64,${b.toString("base64")}`;
  const raster = url(await sharp({ create: { width: 4, height: 153, channels: 4, background: "transparent" } }).png().toBuffer());
  let attempted = 0; const rawWrite = f.api.writeLayerPng;
  f.api.writeLayerPng = async payload => { attempted++; if (failure === "matte" && attempted === 1) throw new Error("matte first write"); return rawWrite(payload); };
  if (failure === "MD") { f.setFault(); f.beforePersist(async () => { f.adapter.owner.publishEdit(p => ({ ...p, name: "P2" }), []); }); }
  const prepare = async (p: Project, ids: string[], isCurrent: () => boolean) => {
    if (failure === "matte") f.adapter.owner.publishEdit(p => ({ ...p, name: "P2" }), []);
    return prepareImportedImageMatte(p, "expanded", ids, { folderPath: f.root, metadataPath: f.metadataPath,
      isCurrent, isWorkspaceCurrent: () => true, dialogueOverlayEnabled: false, setStatus: () => {},
      onRecoveryRequired: message => { f.recovery.current = message; } }, {
      api: f.api as unknown as Window["storyboard"], queue: { ...f.queue, runExclusive: action => action() },
      canvas: { expandBitmapLayer: async (u, _l, top, bottom) => url(await sharp(Buffer.from(u.split(",")[1], "base64")).extend({ top, bottom, left: 0, right: 0, background: "transparent" }).png().toBuffer()), createMatteOverlay: () => raster, createDialogueOverlay: () => raster }
    });
  };
  expect(await f.run({ prepare })).toBe(false); expect(f.recovery.current).toMatch(/Import incomplete/);
  expect(f.ref.current.name).toBe("P2"); expect(f.ref.current.shots[0].imagePath).toBe(before.imagePath);
  expect(f.ref.current.pendingBake!.shots.s.state).toBe("unknown");
  expect(await fs.readFile(path.join(f.root, before.layers![0].bitmapPath))).not.toEqual(oldPng);
  expect((await sharp(before.imagePath).metadata()).width).toBe(4);
  expect(await fs.readFile(before.swb!.archivePath!)).toEqual(f.original);
  if (failure === "matte") expect(await fs.readFile(f.metadataPath)).toEqual(oldJson);
  else expect(JSON.parse(await fs.readFile(f.metadataPath, "utf8")).pendingBake.shots.s.state).toBe("pending");
  expect(await fs.readFile(f.mdPath)).toEqual(oldMd);
  const writes = f.writes.length;
  expect(await f.adapter.save()).toBe(false); expect(await f.adapter.autosave(f.ref.current)).toBe(false);
  expect(f.api.saveWorkspace).not.toHaveBeenCalled(); expect(f.writes).toHaveLength(writes); expect(f.published).toHaveBeenCalledTimes(1);
  const historyText = await fs.readFile(new URL("../../src/renderer/projectHistoryController.ts", import.meta.url), "utf8");
  const historyTree = ts.createSourceFile("history.ts", historyText, ts.ScriptTarget.Latest, true); const selected: string[] = [];
  const visit = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && ["requireHistorySafe", "applyHistoryEntry"].includes(node.name.getText(historyTree))) selected.push(`const ${node.getText(historyTree)};`); ts.forEachChild(node, visit); }; visit(historyTree);
  const firstAsset = vi.fn(), status = vi.fn();
  const bindings = { getRecoveryRequiredMessage: () => f.recovery.current, projectRef: f.ref, setStatus: status,
    isImageImportLocked: () => false, bitmapLayerWriteQueueRef: { current: f.queue },
    createHistoryEntry: firstAsset, restoreHistoryLayerAssets: firstAsset };
  const history = new Function(...Object.keys(appCallerAdapterScope(bindings)), ts.transpile(selected.join("\n") + ";return applyHistoryEntry;", { target: ts.ScriptTarget.ES2022 }))(...Object.values(appCallerAdapterScope(bindings)));
  const pixels = await fs.readFile(path.join(f.root, before.layers![0].bitmapPath));
  await history("undo"); await history("redo"); expect(firstAsset).not.toHaveBeenCalled(); expect(status).toHaveBeenCalled();
  expect(await fs.readFile(path.join(f.root, before.layers![0].bitmapPath))).toEqual(pixels);
});

it.each(["same", "different"] as const)("existing Import matte recovery failure keeps ownership separate from publication: %s epoch", async epochKind => {
  const f = await fixture("layered"); expect(await f.run()).toBe(true);
  const capture = f.adapter.owner.capture(), png = path.join(f.root, f.ref.current.shots[0].layers![0].bitmapPath), original = await fs.readFile(png);
  let loading: Promise<boolean> | undefined; let once = true; const recovery = vi.fn(), status = vi.fn();
  const api = { ...f.api, writeLayerPng: async () => {
    if (once) { once = false;
      if (epochKind === "same") f.adapter.owner.publishEdit(p => ({ ...p, name: "P2-owner" }), []);
      else loading = f.adapter.owner.load({ ...createProject("different epoch"), pendingBake: { version: 1, shots: {} } });
    }
    throw new Error("first write and rollback filesystem failure");
  } };
  const operation = f.queue.runExclusive(() => prepareImportedImageMatte(capture.project, "expanded", ["s"], {
    folderPath: f.root, metadataPath: f.metadataPath,
    isCurrent: () => f.adapter.owner.capture().project === capture.project && f.adapter.owner.capture().epoch === capture.epoch,
    isWorkspaceCurrent: () => f.adapter.owner.capture().epoch === capture.epoch,
    dialogueOverlayEnabled: false, setStatus: status, onRecoveryRequired: recovery
  }, { api: api as unknown as Window["storyboard"], queue: { ...f.queue, runExclusive: action => action() },
    canvas: { expandBitmapLayer: async u => u, createMatteOverlay: () => "unused", createDialogueOverlay: () => "unused" } }));
  await expect(operation).rejects.toThrow(epochKind === "same" ? /rollback also failed/ : /Import matte preparation incomplete/); await loading;
  expect(await fs.readFile(png)).toEqual(original);
  if (epochKind === "same") { expect(recovery).toHaveBeenCalledOnce(); expect(f.ref.current.name).toBe("P2-owner"); }
  else { expect(recovery).not.toHaveBeenCalled(); expect(status).not.toHaveBeenCalled(); expect(f.ref.current.name).toBe("different epoch"); }
});

it("finite actual Import JSON/MD completion releases stale timer then ordinary autosave persists latest P3 paths and tokens", () => verifyFiniteImport(false));
it("r4 shared queue History captured ready refuses snapshots when real dual Import establishes remainingScript, then works after actual consumption", async () => {
  const f = await dualFixture();
  expect(f.adapter.owner.captureEffectAdmission()()).toBe(true);
  f.io.mockClear();
  const io = f.io.getMockImplementation()!;
  let failing = true;
  f.io.mockImplementation(async payload => {
    if (!payload.normalSaveImageImport && !payload.normalSaveAutoImageImport && failing) throw new Error("script reader unavailable before effects");
    return io(payload);
  });
  const owner = f.adapter.owner, epoch = owner.capture().epoch;
  let reads = 0, restores = 0, capturedReady = false;
  const history = useProjectHistoryController({ api: { ...f.api,
    readLayerPng: async (p: Parameters<typeof layer.readLayerPng>[0]) => { reads++; return layer.readLayerPng(p); },
    writeLayerPng: async (p: Parameters<typeof layer.writeLayerPng>[0]) => { restores++; return layer.writeLayerPng(p); }
  }, captureWorkspace: () => {
      const admissible = owner.captureEffectAdmission(); capturedReady = admissible();
      // Test-only negative control of cached-ready execution admission, same real transaction/queue.
      return process.env.SWB_R4_NEGATIVE_HISTORY_READY === "1" ? (() => capturedReady) : admissible;
    },
    isImageImportLocked: () => false, bitmapLayerWriteQueueRef: { current: f.queue },
    fileNameSyncStateRef: { current: "unsynced" }, folderPathRef: { current: f.root },
    projectRef: f.ref, maxEntries: 60, selectedShotIdsRef: { current: ["s"] },
    scriptImportCheckIdRef: { current: 0 }, markShotsDirty: () => {}, selectShotsByIds: () => {},
    setAutosaveRevision: () => {}, setFileNameSyncState: () => {}, setProject: () => {},
    setScriptImportNeeded: () => {}, setStatus: () => {}, setWorkspaceSaveState: () => {},
    publishProject: (p, ids) => owner.publishEdit(p, ids) });
  const initial = f.ref.current.shots[0].layers![0].bitmapPath;
  const original = await fs.readFile(path.join(f.root, initial));
  history.recordUndoEntry({ project: f.ref.current, selectedShotIds: ["s"], fileNameSyncState: "unsynced",
    layerAssets: [{ bitmapPath: initial, dataUrl: `data:image/png;base64,${original.toString("base64")}` }] });
  // Queue synchronously via the real adapter; f.run reads/transpiles App asynchronously before
  // enqueueing and would otherwise let History run first (invalid barrier for this criterion).
  const importing = f.adapter.imageImport({ blankShotPreset: "16:9", dirtyShotIds: [],
    prepare: async p => p, published: f.published });
  const undo = history.applyUndoEntry();
  expect(capturedReady).toBe(true);
  expect(await importing).toBe(false);
  const pngPath = path.join(f.root, f.ref.current.shots[0].layers![0].bitmapPath);
  const afterImport = await fs.readFile(pngPath);
  await undo;
  expect(owner.capture().epoch).toBe(epoch);
  expect(owner.scriptImportRemaining, JSON.stringify(f.errors.map(e => e instanceof Error ? e.message : e))).toBe(true);
  expect(reads).toBe(0);
  expect(restores).toBe(0);
  expect(await fs.readFile(pngPath)).toEqual(afterImport);
  failing = false;
  expect(await f.run()).toBe(true);
  expect(owner.scriptImportRemaining).toBe(false);
  expect(owner.captureEffectAdmission()()).toBe(true);
  // Prove the SAME controller usable after real input consumption, with current-source metadata.
  const currentPath = f.ref.current.shots[0].layers![0].bitmapPath;
  const current = await fs.readFile(path.join(f.root, currentPath));
  history.recordUndoEntry({ project: f.ref.current, selectedShotIds: ["s"], fileNameSyncState: "unsynced",
    layerAssets: [{ bitmapPath: currentPath, dataUrl: `data:image/png;base64,${current.toString("base64")}` }] });
  await history.applyUndoEntry();
  expect(reads).toBe(1);
  expect(restores).toBe(1);
});

it("dual-needed unconsumed script input blocks painting writes until the script stage is consumed", async () => {
  const f = await dualFixture(), io = f.io.getMockImplementation()!;
  let failing = true;
  f.io.mockImplementation(async payload => {
    if (!payload.normalSaveImageImport && !payload.normalSaveAutoImageImport && failing) throw new Error("script reader unavailable before effects");
    return io(payload);
  });
  expect(await f.run()).toBe(false);
  expect(f.adapter.owner.scriptImportRemaining).toBe(true);
  const pickEditable = (project: Project) => bitmapLayersForShot(project.shots[0]).filter(l => !l.locked)[0];
  const shot = f.ref.current.shots[0], layer = pickEditable(f.ref.current);
  expect(bitmapLayersForShot(f.ref.current.shots[0]).map(l => ({ id: l.id, kind: l.kind, locked: l.locked, bitmapPath: l.bitmapPath })), "fixture layers").toBeDefined();
  expect(layer).toBeDefined();
  expect(layer.locked).toBe(false);
  const pngPath = path.join(f.root, layer.bitmapPath), before = await fs.readFile(pngPath);
  const writes: { bitmapPath: string }[] = [];
  const painting = useBitmapLayerPaintingController({
    api: { ...f.api, writeLayerPng: async (payload: { bitmapPath: string; dataUrl: string }) => { writes.push(payload); return f.api.writeLayerPng(payload); },
      readLayerPng: async () => `data:image/png;base64,${before.toString("base64")}` } as unknown as Window["storyboard"],
    captureWorkspace: () => f.adapter.owner.captureEffectAdmission(),
    captureEffectCompletion: () => f.adapter.owner.captureEffectCompletion(), projectRef: f.ref, folderPath: f.root,
    bitmapLayerWriteQueueRef: { current: f.queue }, createHistoryEntryFromLayerAssets: () => ({}),
    recordUndoEntry: () => {}, markShotsDirty: () => {}, updateProject: () => {}
  });
  const blue = await sharp({ create: { width: 8, height: 6, channels: 4, background: "blue" } }).png().toBuffer();
  const url = `data:image/png;base64,${blue.toString("base64")}`;
  await painting.handleBitmapSelectionTransform(shot, layer.id, url);
  expect(writes).toHaveLength(0);
  expect(await fs.readFile(pngPath)).toEqual(before);
  failing = false;
  expect(await f.run()).toBe(true);
  expect(f.adapter.owner.scriptImportRemaining).toBe(false);
  const current = f.ref.current.shots[0], currentLayer = pickEditable(f.ref.current);
  expect(f.adapter.owner.captureEffectAdmission()(), "consumed script input leaves an admissible workspace").toBe(true);
  await painting.handleBitmapSelectionTransform(current, currentLayer.id, url);
  expect(writes).toHaveLength(1);
  expect(await fs.readFile(pngPath)).toEqual(blue);
});
it("automatic finite actual App publication schedules ordinary timer to durably persist P3 after release", () => verifyFiniteImport(true));
async function verifyFiniteImport(automatic: boolean) {
  const f = automatic ? await autoFixture() : await fixture("png"); f.io.mockClear(); const callbacks: (() => void)[] = []; let n = 0;
  const schedule = () => registerWorkspaceAutosave({ autosaveRevision: 1, hasStoryboardApi: true,
    folderPathRef: { current: f.root }, metadataPathRef: { current: f.metadataPath }, projectRef: f.ref,
    timers: { setTimeout: callback => { callbacks.push(callback); return callbacks.length; }, clearTimeout: () => {} },
    setStatus: vi.fn(), setWorkspaceSaveState: vi.fn(), setAutosaveError: vi.fn(), persistWorkspace: p => f.adapter.autosave(p).then(() => undefined) });
  f.beforePersist(async () => { n++; if (n <= 2) {
    f.adapter.owner.publishEdit(p => ({ ...p, name: `P${n + 1}` }), []);
    if (n === 2) { schedule(); callbacks[0](); }
  } });
  const text = await fs.readFile(new URL("../../src/renderer/App.tsx", import.meta.url), "utf8"), tree = ts.createSourceFile("App.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let publication = "", pending = "";
  const visit = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && node.name.getText(tree) === "normalSaveImageImportPublished") publication = node.initializer!.getText(tree);
    if (ts.isPropertyAssignment(node) && node.name.getText(tree) === "onPendingPublication" && node.initializer.getText(tree).includes("setAutosaveRevision")) pending = node.initializer.getText(tree); ts.forEachChild(node, visit); }; visit(tree);
  const controls = { rebasePendingHistory: vi.fn(), setFileNameSyncState: vi.fn(), fileNameSyncStateRef: { current: "synced" }, setWorkspaceSaveState: vi.fn(), workspaceSaveStateRef: { current: "saved" }, setAutosaveRevision: schedule };
  const onPendingPublication = new Function(...Object.keys(controls), ts.transpile(`return (${pending});`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(controls));
  const bindings = { project: f.ref.current, projectRef: f.ref, invalidatePresentationHistory: vi.fn(), normalSaveAppCallbacksRef: { current: { onPendingPublication } }, setStatus: vi.fn() };
  const published = new Function(...Object.keys(appCallerAdapterScope(bindings)), ts.transpile(`return (${publication});`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(appCallerAdapterScope(bindings)));
  if ("hooks" in f) { f.hooks.published = published; await f.refresh(); }
  else expect(await f.run({ published })).toBe(false);
  await f.queue.runExclusive(async () => {});
  expect(n).toBe(2); expect(callbacks).toHaveLength(2); expect(f.io).toHaveBeenCalledOnce();
  expect(f.ref.current.name).toBe("P3"); expect(f.ref.current.pendingBake!.shots.s.state).toBe("pending");
  callbacks[1](); await f.queue.runExclusive(async () => {});
  expect(n).toBe(3); expect(f.io).toHaveBeenCalledOnce();
  expect(JSON.parse(await fs.readFile(f.metadataPath, "utf8"))).toEqual(JSON.parse(JSON.stringify(f.ref.current)));
  expect(await fs.readFile(f.mdPath, "utf8")).toBe(script.serializeStoryboardScriptMarkdown(f.ref.current));
  expect(f.ref.current.pendingBake!.shots.s.acceptedOutputIdentity).toBe(await hash(f.ref.current.shots[0].imagePath));
}
