import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProject } from "../shared/projectOps";
import { initializeCompletedShot, pendingBakeForProject } from "../shared/pendingBake";
import type { Project, Shot } from "../shared/types";
import { createBitmapLayerWriteQueue } from "./bitmapLayerWriteQueue";
import { useBitmapLayerActions } from "./bitmapLayerActions";
import { useBitmapLayerPaintingController } from "./bitmapLayerPaintingController";
import { createNormalSaveProjectOwner } from "./normalSaveProjectOwner";
import { atomicWriteTextFile } from "../../electron/main/fileRenames";
import { writeLayerPng } from "../../electron/main/layerAssetService";
import { serializeStoryboardScriptMarkdown } from "../../electron/main/storyboardScript";

// Real owner + real PNG writer + real queue. The controllers are called with the same option shape
// App supplies. No fake boolean state: every refusal is proven by zero writer calls and unchanged
// on-disk bytes, every success by real encoded PNG bytes.
const scratch = "/Users/pikachu/.hermes/profiles/engineer/cache/scratch/save-normal-spec-891fge5g/tmp";
const hash = async (p: string) => createHash("sha256").update(await readFile(p)).digest("hex");
const ops = { mkdir: async (p: string) => { await mkdir(p, { recursive: true }); }, rename, unlink, writeFile };
const blue = { r: 0, g: 0, b: 255, alpha: 1 } as const;
const png = async (color: string | { r: number; g: number; b: number; alpha: number }) =>
  sharp({ create: { width: 8, height: 6, channels: 4, background: color } }).png().toBuffer();
const dataUrl = async (color: string | { r: number; g: number; b: number; alpha: number }) =>
  `data:image/png;base64,${(await png(color)).toString("base64")}`;

async function fixture(options: { raw?: "unknown" | "future"; seedPending?: boolean } = {}) {
  const root = await mkdtemp(path.join(scratch, "effect-admission-"));
  const metadataPath = path.join(root, ".storyboard-workbench/storyboard.project.json");
  const mdPath = path.join(root, "storyboard-script.md");
  const bitmapPath = ".storyboard-workbench/layers/s/image.png";
  await mkdir(path.dirname(path.join(root, bitmapPath)), { recursive: true });
  await sharp({ create: { width: 8, height: 6, channels: 4, background: "red" } }).png().toFile(path.join(root, bitmapPath));
  const imagePath = path.join(root, "s.tiff");
  await sharp({ create: { width: 8, height: 6, channels: 4, background: "white" } }).tiff({ compression: "none" }).toFile(imagePath);
  const base = createProject("effect-admission");
  base.shots = [{ id: "s", imagePath, fileName: "s.tiff", order: 0,
    swb: { version: 1, status: "owned", canvasWidth: 8, canvasHeight: 6 },
    layers: [{ id: "image", kind: "image", name: "Image", visible: true, locked: false, opacity: 1,
      order: 0, blendMode: "normal", bitmapPath, width: 8, height: 6 }] }];
  const pending = options.raw === "unknown" ? { shots: { s: { state: "unknown" as const } } }
    : options.raw === "future" ? { version: 99, shots: { s: { state: "synced" as const, acceptedOutputIdentity: await hash(imagePath) } } }
    : options.seedPending ? { shots: { s: { state: "pending" as const, editToken: "seed", acceptedOutputIdentity: await hash(imagePath) } } }
    : { shots: { s: { state: "synced" as const, acceptedOutputIdentity: await hash(imagePath) } } };
  let project: Project = { ...base, pendingBake: { version: 1, ...pending } as Project["pendingBake"] };
  const ref = { current: project };
  let token = 0, persists = 0, outputs = 0;
  let beforePersist: (() => Promise<void>) | undefined;
  const writes: unknown[] = [];
  const queue = createBitmapLayerWriteQueue();
  const persist = async (p: Project) => { persists++; await beforePersist?.(); await atomicWriteTextFile(metadataPath, JSON.stringify(p), ops); await atomicWriteTextFile(mdPath, serializeStoryboardScriptMarkdown(p), ops); };
  const owner = createNormalSaveProjectOwner({
    projectRef: ref, setProject: (p) => { ref.current = p; }, freshToken: () => `token-${++token}`,
    queue,
    readIdentity: async (shot: Shot) => hash(shot.imagePath),
    persist,
    captureEffectPersistence: () => ({ folderPath: root, metadataPath, persist }),
    outputWhenClean: true,
    output: async (p: Project, ids: string[]) => { outputs++;
      const outputHash = await hash(imagePath);
      return ids.map(id => ({ shotId: id,
        capturedToken: pendingBakeForProject(p).shots[id].editToken!, sourcePath: imagePath, targetPath: imagePath,
        outputHash })); }
  });
  await owner.load(async () => ref.current);
  // The workspace as actually opened: the same bytes a plain disk reopen reads back.
  await atomicWriteTextFile(metadataPath, JSON.stringify(ref.current), ops);
  const api = {
    readLayerPng: async () => await readFile(path.join(root, bitmapPath)).then(b => `data:image/png;base64,${b.toString("base64")}`),
    writeLayerPng: async (payload: { bitmapPath: string; dataUrl: string }) => { writes.push(payload); return writeLayerPng({ folderPath: root, ...payload }); },
    assetUrl: (p: string) => p
  } as unknown as Window["storyboard"];
  return { root, ref, owner, queue, api, writes, bitmap: path.join(root, bitmapPath), bytes: () => readFile(path.join(root, bitmapPath)),
    persists: () => persists, outputs: () => outputs, metadataPath, mdPath,
    holdPersist: (fn: () => Promise<void>) => { beforePersist = fn; } };
}

describe("normal Save effect admission (dynamic control state)", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("refuses a painting write while the saved receipt is still held, then allows it after persistence settles", async () => {
    const f = await fixture({ seedPending: true });
    const painting = useBitmapLayerPaintingController({ api: f.api, captureWorkspace: () => f.owner.captureEffectAdmission(), captureEffectCompletion: () => f.owner.captureEffectCompletion(),
      projectRef: f.ref, folderPath: f.root, bitmapLayerWriteQueueRef: { current: createBitmapLayerWriteQueue() },
      createHistoryEntryFromLayerAssets: () => ({}), recordUndoEntry: () => {}, markShotsDirty: () => {},
      updateProject: () => {} });
    const shot = f.ref.current.shots[0], layer = shot.layers![0];
    let release!: () => void; const held = new Promise<void>(r => { release = r; });
    let entered!: () => void; const persisting = new Promise<void>(r => { entered = r; });
    f.holdPersist(() => { entered(); return held; });
    const saved = f.owner.save();
    await persisting;
    // The receipt exists only after this Save acknowledged a real output; still held by persist.
    const before = await f.bytes();
    await painting.handleBitmapSelectionTransform(shot, layer.id, await dataUrl(blue));
    expect(f.writes).toHaveLength(0);
    expect(await f.bytes()).toEqual(before);
    release(); expect(await saved).toBe(true);
    await painting.handleBitmapSelectionTransform(shot, layer.id, await dataUrl(blue));
    expect(f.writes).toHaveLength(1);
    expect(await f.bytes()).toEqual(await png(blue));
  });

  it.each(["unknown", "future"] as const)("refuses every painting path on a preserved raw %s project", async state => {
    const f = await fixture({ raw: state });
    const painting = useBitmapLayerPaintingController({ api: f.api, captureWorkspace: () => f.owner.captureEffectAdmission(), captureEffectCompletion: () => f.owner.captureEffectCompletion(),
      projectRef: f.ref, folderPath: f.root, bitmapLayerWriteQueueRef: { current: createBitmapLayerWriteQueue() },
      createHistoryEntryFromLayerAssets: () => ({}), recordUndoEntry: () => {}, markShotsDirty: () => {},
      updateProject: () => {} });
    const shot = f.ref.current.shots[0], layer = shot.layers![0], before = await f.bytes();
    const url = await dataUrl(blue);
    await painting.handleBitmapSelectionTransform(shot, layer.id, url);
    await painting.handleBitmapStroke(shot, layer.id, { id: "s", tool: "brush", color: "blue", size: 1, opacity: 1, points: [0, 0, 1, 1] }, url);
    await painting.handleBitmapFill(shot, layer.id, { x: 0, y: 0 }, "#0000ff");
    await painting.handleBitmapBlur(shot, layer.id, 4);
    expect(f.writes).toHaveLength(0);
    expect(await f.bytes()).toEqual(before);
    expect(await f.owner.save()).toBe(false);
  });

  it("still allows same-epoch continuous strokes and metadata P2 on a supported workspace", async () => {
    const f = await fixture();
    const painting = useBitmapLayerPaintingController({ api: f.api, captureWorkspace: () => f.owner.captureEffectAdmission(), captureEffectCompletion: () => f.owner.captureEffectCompletion(),
      projectRef: f.ref, folderPath: f.root, bitmapLayerWriteQueueRef: { current: createBitmapLayerWriteQueue() },
      createHistoryEntryFromLayerAssets: () => ({}), recordUndoEntry: () => {}, markShotsDirty: () => {},
      updateProject: (update) => { f.owner.publishEdit(typeof update === "function" ? update : update, ["s"]); } });
    const shot = f.ref.current.shots[0], layer = shot.layers![0];
    await painting.handleBitmapSelectionTransform(shot, layer.id, await dataUrl(blue));
    const firstToken = pendingBakeForProject(f.ref.current).shots.s.editToken;
    await painting.handleBitmapSelectionTransform(shot, layer.id, await dataUrl("green"));
    expect(pendingBakeForProject(f.ref.current).shots.s.editToken).not.toBe(firstToken);
    expect(f.writes).toHaveLength(2);
    expect(f.owner.publishEdit(p => ({ ...p, name: "metadata P2" }), [])).toBe(true);
    expect(f.ref.current.name).toBe("metadata P2");
    expect(f.writes).toHaveLength(2);
  });

  it("records an already-written PNG whose scope rotated so a plain reload cannot report it synced", async () => {
    const f = await fixture({ seedPending: true });
    let pendingLoad: Promise<boolean> | undefined;
    // The real write completes, then a genuinely newer load request starts before publication.
    const realWrite = f.api.writeLayerPng;
    (f.api as { writeLayerPng: Window["storyboard"]["writeLayerPng"] }).writeLayerPng = async payload => {
      const result = await realWrite(payload);
      pendingLoad = f.owner.load(async () => JSON.parse(await readFile(f.metadataPath, "utf8")));
      return result;
    };
    const painting = useBitmapLayerPaintingController({ api: f.api, captureWorkspace: () => f.owner.captureEffectAdmission(),
      captureEffectCompletion: () => f.owner.captureEffectCompletion(),
      projectRef: f.ref, folderPath: f.root, bitmapLayerWriteQueueRef: { current: f.queue },
      createHistoryEntryFromLayerAssets: () => ({}), recordUndoEntry: () => {}, markShotsDirty: () => {},
      updateProject: () => {} });
    const shot = f.ref.current.shots[0], layer = shot.layers![0];
    await expect(painting.handleBitmapSelectionTransform(shot, layer.id, await dataUrl(blue))).rejects.toThrow(/retained without stale publication/u);
    expect(await pendingLoad).toBe(true);
    // The real PNG write completed: the fact must be preserved, never reverted or forgotten.
    expect(f.writes).toHaveLength(1);
    expect(await f.bytes()).toEqual(await png(blue));
    // Plain reload of the same workspace must not present the altered PNG as a saved output.
    expect(await f.owner.load(async () => JSON.parse(await readFile(f.metadataPath, "utf8")))).toBe(true);
    // Full admitted painting completion has trustworthy metadata/source, unlike ambiguous/partial
    // effects: ordinary bound required persistence establishes pending, not permanent unknown.
    expect(pendingBakeForProject(f.ref.current).shots.s.state).toBe("pending");
    expect(pendingBakeForProject(f.ref.current).shots.s.editToken).toBeTruthy();
    expect(JSON.parse(await readFile(f.metadataPath, "utf8")).pendingBake.shots.s).toEqual(pendingBakeForProject(f.ref.current).shots.s);
    expect(await f.owner.autosave()).toBe(true);
    // Do not use this fixture's non-baking output stub as TIFF proof; the main-chain test asserts
    // the real production Save pixels and fresh-owner disk reconstruction.
  });

  it("records a completed layer-delete effect whose publication is refused by a load in flight", async () => {
    const f = await fixture();
    vi.stubGlobal("window", { storyboard: f.api });
    const transparent = await png({ r: 0, g: 0, b: 0, alpha: 0 });
    let pendingLoad: Promise<boolean> | undefined;
    // The real clear write completes, then a genuinely newer load request starts before publication.
    const realWrite = f.api.writeLayerPng;
    (f.api as { writeLayerPng: Window["storyboard"]["writeLayerPng"] }).writeLayerPng = async payload => {
      const result = await realWrite(payload);
      pendingLoad = f.owner.load(async () => JSON.parse(await readFile(f.metadataPath, "utf8")));
      return result;
    };
    const actions = useBitmapLayerActions({ captureEnsureScope: () => f.owner.captureEffectAdmission(),
      captureEffectCompletion: () => f.owner.captureEffectCompletion(),
      isImageImportLocked: () => false, projectRef: f.ref, folderPath: f.root,
      bitmapLayerWriteQueueRef: { current: f.queue },
      createTransparentLayerDataUrl: async () => `data:image/png;base64,${transparent.toString("base64")}`,
      createHistoryEntry: async () => ({}), recordUndoEntry: () => {}, markShotsDirty: () => {},
      updateProject: () => {}, setStatus: () => {} });
    const shot = f.ref.current.shots[0], layer = shot.layers![0];
    await actions.handleClearBitmapLayer(shot.id, layer.id);
    expect(await pendingLoad).toBe(true);
    expect(await f.bytes()).toEqual(transparent);
    // Full clear target is now durably pending; it must never look clean without actual output.
    expect(pendingBakeForProject(f.ref.current).shots.s.state).not.toBe("synced");
    expect(pendingBakeForProject(f.ref.current).shots.s.state).toBe("pending");
    expect(f.ref.current.shots[0].layers![0].cleared).toBe(true);
    expect(JSON.parse(await readFile(f.metadataPath, "utf8")).pendingBake.shots.s.state).toBe("pending");
  });
});
