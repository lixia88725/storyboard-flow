import os from "node:os";
import { createHash } from "node:crypto";
import { rm, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { onTestFinished, expect, it, afterEach, vi } from "vitest";
import { createProject } from "../shared/projectOps";
import { createBitmapLayerWriteQueue } from "./bitmapLayerWriteQueue";
import { createNormalSaveProjectOwner } from "./normalSaveProjectOwner";
import { useBitmapLayerActions } from "./bitmapLayerActions";
import { readLayerAssetSnapshots } from "./bitmapLayerHistory";
import { createLayerPng, readLayerPng } from "../../electron/main/layerAssetService";
import type { CreateLayerAssetPayload, CreateLayerAssetResult } from "../../electron/main/layerAssetService";
import { serializeStoryboardScriptMarkdown } from "../../electron/main/storyboardScript";
import type { Project } from "../shared/types";
const scratch = process.env.TMPDIR ?? os.tmpdir();
const hash = async (file: string) => createHash("sha256").update(await readFile(file)).digest("hex");
async function fixture() {
  const root = await mkdtemp(path.join(scratch, "owner-green-"));
  onTestFinished(async () => { await rm(root, { recursive: true, force: true }); });
  await mkdir(path.join(root, ".storyboard-workbench/layers/s"), { recursive: true });
  const imagePath = path.join(root, "s.tiff"), bitmapPath = ".storyboard-workbench/layers/s/layer-image.png";
  const old = await sharp({ create: { width: 2, height: 2, channels: 4, background: "red" } }).png().toBuffer();
  const transparent = await sharp({ create: { width: 2, height: 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  await writeFile(path.join(root, bitmapPath), old); await sharp(old).tiff({ compression: "none" }).toFile(imagePath);
  const p = createProject("owned-add");
  p.shots = [{ id: "s", imagePath, fileName: "s.tiff", order: 0, swb: { version: 1, status: "owned", canvasWidth: 2, canvasHeight: 2 },
    layers: [{ id: "layer-image", kind: "image", name: "Image", bitmapPath, width: 2, height: 2, order: 0, visible: true, locked: false, opacity: 1, blendMode: "normal" }] }];
  p.pendingBake = { version: 1, shots: { s: { state: "synced", acceptedOutputIdentity: await hash(imagePath) } } };
  const ref = { current: p }, queue = createBitmapLayerWriteQueue(), histories: Array<{ project: Project; layerAssets: Awaited<ReturnType<typeof readLayerAssetSnapshots>> }> = [];
  const metadata = path.join(root, ".storyboard-workbench/storyboard.project.json"), md = path.join(root, "storyboard-script.md");
  const persisted: Project[] = []; const persist = async (project: Project) => { await writeFile(metadata, JSON.stringify(project)); await writeFile(md, serializeStoryboardScriptMarkdown(project)); persisted.push(project); };
  let token = 0;
  const owner = createNormalSaveProjectOwner({ projectRef: ref, setProject: project => { ref.current = project; }, freshToken: () => `real-effect-${++token}`, queue,
    readIdentity: shot => hash(shot.imagePath), persist, captureEffectPersistence: () => ({ folderPath: root, metadataPath: metadata, persist }),
    output: async () => { throw new Error("This fixture does not certify Save output"); } });
  await owner.load(async () => p); await persist(ref.current); persisted.length = 0;
  let create: (payload: CreateLayerAssetPayload) => Promise<CreateLayerAssetResult> = createLayerPng;
  const calls: CreateLayerAssetPayload[] = [];
  const api = { readLayerPng, createLayerPng: async (payload: CreateLayerAssetPayload) => { calls.push(payload); return create(payload); } } as unknown as NonNullable<Window["storyboard"]>;
  vi.stubGlobal("window", { storyboard: api });
  // The original installed history obligation is separate from late UI publication.
  const completedHistories: unknown[] = [];
  const actions = useBitmapLayerActions<(typeof histories)[number]>({ projectRef: ref, folderPath: root, bitmapLayerWriteQueueRef: { current: queue },
    captureCompletedHistory: () => entry => { completedHistories.push(entry); },
    captureEnsureScope: () => owner.captureEffectAdmission(), captureEffectCompletion: () => owner.captureEffectCompletion(), getWorkspaceIdentity: () => ref,
    isImageImportLocked: () => false, createTransparentLayerDataUrl: async () => `data:image/png;base64,${transparent.toString("base64")}`,
    createHistoryEntry: async paths => ({ project: ref.current, layerAssets: await readLayerAssetSnapshots(api, root, paths ?? []) }),
    getHistoryLayerAssets: entry => entry.layerAssets, rebaseAddHistoryEntry: (entry, project) => ({ ...entry, project }), recordUndoEntry: entry => { histories.push(entry); },
    markShotsDirty: () => {}, updateProject: update => { if (!owner.publishEdit(update, ["s"])) throw Error("Actual owner refused Add publication"); }, setStatus: () => {} });
  const hold = () => { let release!: () => void, entered!: () => void; const started = new Promise<void>(r => { entered = r; }), gate = new Promise<void>(r => { release = r; });
    create = async payload => { const ack = await createLayerPng(payload); entered(); await gate; return ack; };return { started, release }; };
  return { root, ref, p, owner, queue, histories, persisted, metadata, md, imagePath, bitmapPath, old, transparent, calls, actions, hold, setCreate: (f: typeof create) => { create = f; } };
}
afterEach(() => vi.unstubAllGlobals());
it("real create/owner producer records pre-Add absence and ordinary autosave persists complete descriptor", async () => {
  const f = await fixture(); await f.actions.handleAddBitmapLayer("s");
  const added = f.ref.current.shots[0].layers!.at(-1)!;
  expect(await readFile(path.join(f.root, added.bitmapPath))).toEqual(f.transparent);
  expect(f.histories).toHaveLength(1); expect(f.histories[0].layerAssets).toEqual([{ bitmapPath: added.bitmapPath, dataUrl: undefined }]);
  expect(f.histories[0].project.shots[0].layers).toHaveLength(1); await f.owner.autosave();
  expect(JSON.parse(await readFile(f.metadata, "utf8")).shots[0].layers).toHaveLength(2); expect(await readFile(f.md, "utf8")).toBe(serializeStoryboardScriptMarkdown(f.ref.current));
  expect(await readFile(path.join(f.root, f.bitmapPath))).toEqual(f.old);
});
it("same-workspace concurrent metadata merges exact Add delta and rebases pre-Add History", async () => {
  const f = await fixture(), gate = f.hold(); const task = f.actions.handleAddBitmapLayer("s"); await gate.started;
  f.owner.publishEdit(p => ({ ...p, name: "new name", shots: p.shots.map(s => ({ ...s, scriptText: "new action", layers: s.layers!.map(l => ({ ...l, name: "new layer name" })) })) }), []);
  const latest = f.ref.current; gate.release(); await task;
  expect(f.ref.current.name).toBe("new name"); expect(f.ref.current.shots[0].scriptText).toBe("new action"); expect(f.ref.current.shots[0].layers![0].name).toBe("new layer name");
  expect(f.histories[0].project).toBe(latest); expect(f.histories[0].layerAssets[0].dataUrl).toBeUndefined();
});
it("actual queued A→B→A load epochs preserve original completed obligation before latest disk load", async () => {
  const f = await fixture(), gate = f.hold(); const task = f.actions.handleAddBitmapLayer("s"); await gate.started;
  const b = f.owner.load(async () => createProject("B"));
  const a = f.owner.load(async () => JSON.parse(await readFile(f.metadata, "utf8")) as Project);
  gate.release(); await task; await Promise.all([b, a]);
  expect(f.ref.current.name).toBe("owned-add"); expect(f.ref.current.shots[0].layers).toHaveLength(2);
  expect(f.persisted.some(p => p.shots[0]?.layers?.length === 2)).toBe(true); expect(f.histories).toHaveLength(0);
});
it("arrival after real History absence is refused with existing bytes/inode and old namespace retained", async () => {
  const f = await fixture(); const before = f.ref.current;
  f.setCreate(async payload => { await writeFile(path.join(payload.folderPath, payload.bitmapPath), f.old); return createLayerPng(payload); });
  await f.actions.handleAddBitmapLayer("s"); expect(f.ref.current).toBe(before); expect(f.histories).toHaveLength(0);
  expect(await readFile(path.join(f.root, f.calls[0].bitmapPath))).toEqual(f.old); expect(f.owner.captureEffectAdmission()()).toBe(true);
});
it("actual complete PNG with lost ACK is retained unknown, never metadata/History success", async () => {
  const f = await fixture(); const beforeJSON = await readFile(f.metadata), beforeMD = await readFile(f.md);
  f.setCreate(async payload => { const ack = await createLayerPng(payload); if (!ack.ok) throw Error(ack.message); throw Error("actual transport ACK lost"); });
  await expect(f.actions.handleAddBitmapLayer("s")).rejects.toThrow("actual transport ACK lost");
  expect(f.ref.current.shots[0].layers).toHaveLength(1); expect(f.histories).toHaveLength(0); expect(f.ref.current.pendingBake!.shots.s.state).toBe("unknown");
  expect(await readFile(path.join(f.root, f.calls[0].bitmapPath))).toEqual(f.transparent); expect(await readFile(f.metadata)).toEqual(beforeJSON); expect(await readFile(f.md)).toEqual(beforeMD);
  expect(f.owner.captureEffectAdmission()()).toBe(false);
});
it.each(["unknown", "future", "corrupt"])("%s source has no initialization or publication", async raw => {
  const f = await fixture(); if (raw === "unknown") f.ref.current.pendingBake!.shots.s = { state: "unknown" };
  else f.ref.current.pendingBake = (raw === "future" ? { version: 99, shots: {} } : "corrupt") as unknown as Project["pendingBake"];
  const before = f.ref.current; await f.actions.handleAddBitmapLayer("s"); expect(f.calls).toHaveLength(0); expect(f.histories).toHaveLength(0); expect(f.ref.current).toBe(before);
});
