import { appCallerAdapterScope, createAppRootActor } from './appCallerAdapterScope';
import { lstat, readFile, mkdtemp, mkdir, rm, readdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import ts from "typescript";
import sharp from "sharp";
import { expect, it } from "vitest";
import { createProject } from "../shared/projectOps";
import type { Project } from "../shared/types";
import { initializeCompletedShot } from "../shared/pendingBake";
import { historyDirtyShotIds } from "./projectHistoryController";
import { changedShotIdsForBitmapRevision, bumpShotBitmapRevisions } from "./shotBitmapRevision";
import { createNormalSaveAppAdapter } from "./normalSaveAppAdapter";
import { createBitmapLayerWriteQueue } from "./bitmapLayerWriteQueue";
import { useLayerMetadataActionController } from "./layerMetadataActionController";
import { registerWorkspacePersistenceIpcHandlers } from "../../electron/main/ipc/workspacePersistenceHandlers";
import { atomicWriteTextFile } from "../../electron/main/fileRenames";
import { readProjectMetadata } from "../../electron/main/projectMetadataService";
import { serializeStoryboardScriptMarkdown } from "../../electron/main/storyboardScript";
import { mkdir as fsMkdir, rename, unlink, writeFile } from "node:fs/promises";
const hash = async (file: string) => createHash("sha256").update(await readFile(file)).digest("hex");
async function appUpdate(bindings: Record<string, unknown>) {
  const source = await readFile(new URL("./App.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let decl: ts.VariableDeclaration | undefined;
  const walk = (n: ts.Node) => { if (ts.isVariableDeclaration(n) && n.name.getText(ast) === "updateProject") decl = n; ts.forEachChild(n, walk); }; walk(ast);
  return new Function(...Object.keys(appCallerAdapterScope(bindings)), ts.transpile(`const ${decl!.getText(ast)}; return updateProject;`))(...Object.values(appCallerAdapterScope(bindings)));
}
async function actualEnsure() {
  const { shouldEnsureLayerAssetsForShot } = await import("../../electron/main/bitmapLayers");
  const { pathExists } = await import("../../electron/main/pathSafety");
  const { resolveLayerAssetPath } = await import("../../electron/main/layerAssetService");
  const { sketchLayersForShot } = await import("../shared/projectOps");
  const source = await readFile(new URL("../../electron/main/main.ts", import.meta.url), "utf8");
  const ast = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
  const names = new Set(["ensureProjectLayerAssets", "createImageBitmapLayerPng", "createPaintBitmapLayerPng", "transparentLayerBuffer", "createTransparentLayerPng", "strokeSvg"]);
  const found: string[] = [];
  const walk = (n: ts.Node) => { if (ts.isVariableDeclaration(n) && names.has(n.name.getText(ast))) found.push(`const ${n.getText(ast)};`); ts.forEachChild(n, walk); }; walk(ast);
  expect(found).toHaveLength(names.size);
  const { writeProtectedLayerFile } = await import("../../electron/main/protectedLayerFileWriter");
  const ports = { shouldEnsureLayerAssetsForShot, pathExists, resolveLayerAssetPath, sketchLayersForShot, mkdir, path, sharp, writeFile, writeProtectedLayerFile, sharpSourceOptions: { unlimited: true } };
  return new Function(...Object.keys(ports), ts.transpile(found.join("\n") + "; return ensureProjectLayerAssets;"))(...Object.values(ports)) as (p: Project, folder: string) => Promise<void>;
}
async function actualRootIdentity() {
  const source = await readFile(new URL("../../electron/main/main.ts", import.meta.url), "utf8");
  const ast = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
  let handler: ts.Expression | undefined;
  const walk = (n: ts.Node) => { if (ts.isCallExpression(n) && n.arguments[0]?.getText(ast) === '"workspace:readOutputIdentity"') handler = n.arguments[1]; ts.forEachChild(n, walk); }; walk(ast);
  expect(handler).toBeDefined();
  const call = new Function("path", "createHash", "readFile", ts.transpile(`const handler = ${handler!.getText(ast)}; return handler;`))(path, createHash, readFile);
  return (imagePath: string) => call(undefined, imagePath) as Promise<string>;
}
async function fixture() {
  const folder = await mkdtemp(path.join(process.env.TMPDIR!, "m3a-producer-"));
  const imagePath = path.join(folder, "s.tiff"), metadataPath = path.join(folder, ".storyboard-workbench/storyboard.project.json");
  await mkdir(path.dirname(metadataPath), { recursive: true });
  await sharp({ create: { width: 8, height: 6, channels: 4, background: "white" } }).tiff().toFile(imagePath);
  await mkdir(path.join(folder, ".storyboard-workbench/layers/s"), { recursive: true });
  await sharp({ create: { width: 8, height: 6, channels: 4, background: "red" } }).png().toFile(path.join(folder, ".storyboard-workbench/layers/s/l.png"));
  let initial: Project = { ...createProject("P"), shots: [{ id: "s", order: 0, imagePath, fileName: "s.tiff", swb: { version: 1, status: "owned", canvasWidth: 8, canvasHeight: 6 }, layers: [{ id: "l", name: "Image", kind: "image", order: 0, bitmapPath: ".storyboard-workbench/layers/s/l.png", width: 8, height: 6, visible: true, opacity: 1, locked: false, blendMode: "normal" }] }] };
  initial = initializeCompletedShot(initial, "s", await hash(imagePath), "initial");
  const projectRef = { current: initial }, queue = createBitmapLayerWriteQueue(); let token = 0;
  const handlers = new Map<string, (...args: any[]) => Promise<any>>();
  const ensure = await actualEnsure();
  registerWorkspacePersistenceIpcHandlers<any>({ handle: ((name: string, fn: any) => handlers.set(name, fn)) as never }, { ensureProjectLayerAssets: ensure, writeProjectFiles: async (_m, _f, p) => {
    const ops = { mkdir: async (p: string) => { await fsMkdir(p, { recursive: true }); }, rename, unlink, writeFile };
    await atomicWriteTextFile(metadataPath, JSON.stringify(p), ops);
    await atomicWriteTextFile(path.join(folder, "storyboard-script.md"), serializeStoryboardScriptMarkdown(p), ops);
  } });
  const api = { readOutputIdentity: await actualRootIdentity(), autosaveWorkspace: (payload: any) => handlers.get("workspace:autosave")!(undefined, payload), saveWorkspace: async () => { throw new Error("not exercised"); } };
  const adapter = await createAppRootActor({ projectRef, setProject: p => { expect(projectRef.current).toBe(p); }, queue, freshToken: () => `new-${++token}`, api: () => api, paths: () => ({ folderPath: folder, metadataPath }), onSave: () => {}, onError: () => {} });
  const noop = () => {};
  const update = await appUpdate({ projectRef, normalSaveAppEnabled: true, normalSaveAppAdapterRef: { current: adapter }, historyDirtyShotIds, changedShotIdsForBitmapRevision, bumpShotBitmapRevisions, recordProjectUndoEntry: noop, projectAcceptedExternalEdits: noop, setShotBitmapRevisionById: noop, setProject: noop, setWorkspaceSaveState: noop, setFileNameSyncState: noop, setAutosaveRevision: noop, scriptImportCheckIdRef: { current: 0 }, setScriptImportNeeded: noop });
  return { folder, metadataPath, projectRef, adapter, update, initial, api, queue, cleanup: () => rm(folder, { recursive: true, force: true }) };
}
it("actual App common publication couples layer opacity to fresh token and actual JSON/MD reader reload", async () => {
  const f = await fixture(); try {
    const c = useLayerMetadataActionController({ updateProject: f.update, markShotsDirty: () => {}, setDeleteTarget: () => {}, shotSelectionAnchorIdRef: { current: undefined } });
    c.handleUpdateLayer("s", "l", { opacity: 0.4 });
    expect(f.projectRef.current.pendingBake!.shots.s.editToken).not.toBe("initial");
    expect(await f.adapter.autosave(f.projectRef.current)).toBe(true);
    const disk = await readProjectMetadata<Project>(f.metadataPath);
    expect(disk!.shots[0].layers![0].opacity).toBe(0.4);
    expect(disk!.pendingBake!.shots.s).toEqual(f.projectRef.current.pendingBake!.shots.s);
    await f.adapter.owner.load(async () => (await readProjectMetadata<Project>(f.metadataPath))!);
    expect(f.projectRef.current.pendingBake!.shots.s.state).toBe("pending");
  } finally { await f.cleanup(); }
});
it("actual App pixel-only equal-value layers and resize publish new obligation but selection/name do not", async () => {
  const f = await fixture(); try {
    f.update((p: Project) => ({ ...p, shots: p.shots.map(s => ({ ...s, activeLayerId: "l" })) }));
    expect(f.projectRef.current.pendingBake!.shots.s.editToken).toBe("initial");
    f.update((p: Project) => ({ ...p, name: "Renamed" }));
    expect(f.projectRef.current.pendingBake!.shots.s.editToken).toBe("initial");
    f.update((p: Project) => ({ ...p, shots: p.shots.map(s => ({ ...s, layers: [...s.layers!] })) }));
    const t = f.projectRef.current.pendingBake!.shots.s.editToken;
    expect(t).not.toBe("initial");
    f.update((p: Project) => ({ ...p, shots: p.shots.map(s => ({ ...s, swb: { ...s.swb!, canvasWidth: 1230 } })) }));
    expect(f.projectRef.current.pendingBake!.shots.s.editToken).not.toBe(t);
    expect(await f.adapter.autosave(f.projectRef.current)).toBe(true);
    expect((await readProjectMetadata<Project>(f.metadataPath))!.shots[0].swb!.canvasWidth).toBe(1230);
  } finally { await f.cleanup(); }
});
it("new-shot initialization reads actual root H0, merges edits during await and cancels scope without publishing", async () => {
  const f = await fixture(); try {
    const imagePath = path.join(f.folder, "new.tiff");
    await sharp({ create: { width: 8, height: 6, channels: 4, background: "blue" } }).tiff().toFile(imagePath);
    const shot = { ...f.initial.shots[0], id: "n", imagePath, fileName: "new.tiff" };
    const insert = (p: Project) => ({ ...p, shots: [...p.shots, shot] });
    expect(typeof (f.adapter.owner as any).publishNewShot, "actual initializer missing").toBe("function");
    // Actual main hash of the completed root, never a renderer-supplied identity.
    const owner = f.adapter.owner as any;
    const publishing = owner.publishNewShot(insert, "n", () => true);
    f.update((p: Project) => ({ ...p, name: "latest" }));
    expect(await publishing).toBe(true);
    expect(f.projectRef.current.name).toBe("latest");
    expect(f.projectRef.current.pendingBake!.shots.n).toEqual({ state: "pending", editToken: expect.any(String), acceptedOutputIdentity: await hash(imagePath) });
    expect(f.projectRef.current.pendingBake!.shots.s.acceptedOutputIdentity).toBe(f.initial.pendingBake!.shots.s.acceptedOutputIdentity);
    expect(await f.adapter.autosave(f.projectRef.current)).toBe(true);
    expect((await readProjectMetadata<Project>(f.metadataPath))!.pendingBake!.shots.n.state).toBe("pending");
    expect(await owner.publishNewShot((p: Project) => ({ ...p, shots: [...p.shots, { ...shot, id: "cancel" }] }), "cancel", () => false)).toBe(false);
    expect(f.projectRef.current.shots.some(s => s.id === "cancel")).toBe(false);
  } finally { await f.cleanup(); }
});
it("actual Add caller initializes the completed blank root, not a renderer hash", async () => {
  const f = await fixture(); try {
    const { useAddShotController, prepareAddShotMatte } = await import("./addShotController");
    const { createBlankShot } = await import("../../electron/main/blankShotService");
    const { writeLayerPng, readLayerPng } = await import("../../electron/main/layerAssetService");
    f.update((p: Project) => ({ ...p, shots: p.shots.map(s => ({ ...s, presentation: { matte: { mode: "expanded", top: 75, bottom: 75, sourceHeight: 6 } } })) }));
    const overlay = `data:image/png;base64,${(await sharp({ create: { width: 1920, height: 1230, channels: 4, background: "transparent" } }).png().toBuffer()).toString("base64")}`;
    const origin = { identity: {}, folderPath: f.folder, metadataPath: f.metadataPath };
    const statuses: string[] = [];
    const api = { createBlankShot: async (folder: string) => {
      const imagePath = await createBlankShot(folder, "16:9");
      return { imagePath, fileName: path.basename(imagePath), width: 1920, height: 1080 };
    }, writeLayerPng, readLayerPng, ensureLayerAssets: async (payload: any) => { await (await actualEnsure())(payload.project, payload.folderPath); return payload; } } as any;
    const c = useAddShotController({ isImageImportLocked: () => false, api, blankShotPreset: "16:9", captureWorkspace: () => origin, isCurrentWorkspace: (r: object) => r === origin,
      createTransparentLayerDataUrl: async (width: number, height: number) => `data:image/png;base64,${(await sharp({ create: { width, height, channels: 4, background: "transparent" } }).png().toBuffer()).toString("base64")}`,
      folderPath: f.folder, metadataPath: f.metadataPath, primarySelectedShotId: "s", projectRef: f.projectRef, loadFolderScan: async () => undefined, inheritSceneMatte: async (p: Project, mode: "expanded" | "embedded", ids: string[], request: any) => {
        const prepared = await prepareAddShotMatte(p, mode, ids, request, { api, queue: createBitmapLayerWriteQueue(), canvas: {
          expandBitmapLayer: async (source, _layer, top, bottom) => `data:image/png;base64,${(await sharp(Buffer.from(source.split(",")[1], "base64")).extend({ top, bottom, left: 0, right: 0, background: "transparent" }).png().toBuffer()).toString("base64")}`,
          createMatteOverlay: () => overlay
        } });
        f.update((latest: Project) => ({ ...latest, name: "edited while Add awaited" }));
        return prepared;
      },
      markShotsDirty: () => {}, selectSingleShot: () => {}, setRecentFolders: () => {}, setStatus: (s: string) => statuses.push(s), setWorkspaceTask: () => {}, updateProject: f.update,
      publishNewShot: (update: (p: Project) => Project, id: string, current: () => boolean) => f.adapter.owner.publishNewShot(update, id, current)
    } as any);
    await c.handleAddShot();
    const added = f.projectRef.current.shots.find(s => s.id !== "s")!;
    expect(added).toBeDefined();
    expect(added.swb!.canvasHeight).toBe(1230);
    expect(f.projectRef.current.name).toBe("edited while Add awaited");
    expect((await sharp(added.imagePath).metadata()).height).toBe(1080);
    for (const layer of added.layers!) expect((await sharp(path.join(f.folder, layer.bitmapPath)).metadata()).height).toBe(1230);
    expect(f.projectRef.current.pendingBake!.shots[added.id]).toEqual({ state: "pending", editToken: expect.any(String), acceptedOutputIdentity: await hash(added.imagePath) });
    expect(await f.adapter.autosave(f.projectRef.current)).toBe(true);
    expect((await readProjectMetadata<Project>(f.metadataPath))!.pendingBake!.shots[added.id].state).toBe("pending");
    expect(statuses.at(-1)).toMatch(/^Added/);
  } finally { await f.cleanup(); }
});
it("actual shot Paste initializes actual copied root H0; layer Paste only advances target token", async () => {
  const f = await fixture(); try {
    const { useClipboardActionController } = await import("./clipboardActionController");
    const { createWorkspaceAssetAppHandlers } = await import("../../electron/main/workspaceAssetAppRuntime");
    const actualCopy = createWorkspaceAssetAppHandlers({ uniquePath: async (folder, name) => path.join(folder, name) });
    const { copyFile } = await import("node:fs/promises");
    const bitmap = f.projectRef.current.shots[0].layers![0].bitmapPath;
    await mkdir(path.dirname(path.join(f.folder, bitmap)), { recursive: true });
    await sharp({ create: { width: 8, height: 6, channels: 4, background: "red" } }).png().toFile(path.join(f.folder, bitmap));
    const origin = { identity: {}, folderPath: f.folder, metadataPath: f.metadataPath };
    const selection = { current: { type: "shot", shotId: "s" } as any };
    const target = { current: { type: "shot" } as any };
    const statuses: string[] = [];
    const api = { ensureLayerAssets: async () => ({}), copyLayerPng: async (p: any) => { const to = path.join(f.folder, p.targetBitmapPath); await mkdir(path.dirname(to), { recursive: true }); await copyFile(path.join(f.folder, p.sourceBitmapPath), to); return p; }, copyShotAssets: (p: any) => actualCopy.copyShotAssets(p) };
    const c = useClipboardActionController({ isImageImportLocked: () => false, api: api as any, captureWorkspace: () => origin, isCurrentWorkspace: (r: object) => r === origin, bitmapLayerWriteQueueRef: { current: createBitmapLayerWriteQueue() }, clipboardSelectionRef: selection, createHistoryEntry: async () => ({}), createId: () => "pasted", deleteTargetRef: target, folderPath: f.folder, metadataPath: f.metadataPath, markShotsDirty: () => {}, projectRef: f.projectRef, queuePasteAnimation: () => {}, recordUndoEntry: () => {}, selectSingleShot: () => {}, selectedShotIdsRef: { current: ["s"] }, setClipboardSelection: () => {}, setDeleteTarget: (p: any) => target.current = p, setSelectedBitmapLayerIds: () => {}, setStatus: (s: string) => statuses.push(s), updateProject: f.update,
      publishNewShot: (update: (p: Project) => Project, id: string, current: () => boolean) => f.adapter.owner.publishNewShot(update, id, current)
    } as any);
    await c.handlePasteSelection();
    const pasted = f.projectRef.current.shots.find(s => s.id === "pasted")!;
    expect(pasted).toBeDefined();
    expect(f.projectRef.current.pendingBake!.shots.pasted).toEqual({ state: "pending", editToken: expect.any(String), acceptedOutputIdentity: await hash(pasted.imagePath) });
    const baseline = f.projectRef.current.pendingBake!.shots.s.acceptedOutputIdentity;
    selection.current = { type: "layer", shotId: "pasted", layerId: pasted.layers![0].id };
    target.current = { type: "layer", shotId: "s", layerId: "l" };
    const token = f.projectRef.current.pendingBake!.shots.s.editToken;
    await c.handlePasteSelection();
    expect(f.projectRef.current.pendingBake!.shots.s.acceptedOutputIdentity).toBe(baseline);
    expect(f.projectRef.current.pendingBake!.shots.s.editToken).not.toBe(token);
    expect(await f.adapter.autosave(f.projectRef.current)).toBe(true);
    expect((await readProjectMetadata<Project>(f.metadataPath))!.pendingBake!.shots.pasted.state).toBe("pending");
  } finally { await f.cleanup(); }
});
it("parked edits keep their output obligation and explicit unknown initialization cannot wash old control", async () => {
  const f = await fixture(); try {
    const parked = { ...f.initial.shots[0], id: "parked" };
    f.projectRef.current = { ...f.initial, parkedShots: [parked], pendingBake: { ...f.initial.pendingBake!, shots: { ...f.initial.pendingBake!.shots, parked: { state: "pending", editToken: "parked-old", acceptedOutputIdentity: f.initial.pendingBake!.shots.s.acceptedOutputIdentity } } } };
    f.update((p: Project) => ({ ...p, parkedShots: p.parkedShots!.map(s => ({ ...s, layers: [...s.layers!] })) }));
    expect(f.projectRef.current.pendingBake!.shots.parked.editToken).not.toBe("parked-old");
    const unknown = { ...f.initial, pendingBake: { version: 1 as const, shots: { s: { state: "unknown" as const, reason: "retain" } } } };
    expect(initializeCompletedShot(unknown, "s", "0".repeat(64), "wash").pendingBake!.shots.s.state).toBe("unknown");
  } finally { await f.cleanup(); }
});
it("actual paint/selection producer keeps equal-metadata pixel edit through JSON reader and real TIFF exporter", async () => {
  const f = await fixture(); try {
    const { useBitmapLayerPaintingController } = await import("./bitmapLayerPaintingController");
    const { readLayerPng, writeLayerPng } = await import("../../electron/main/layerAssetService");
    const { writePhotoshopLayeredTiffsForInPlaceSave } = await import("../../electron/main/photoshopTiffExport");
    const blue = `data:image/png;base64,${(await sharp({ create: { width: 8, height: 6, channels: 4, background: "blue" } }).png().toBuffer()).toString("base64")}`;
    const c = useBitmapLayerPaintingController({ captureWorkspace: () => f.adapter.owner.captureEffectAdmission(), captureEffectCompletion: () => f.adapter.owner.captureEffectCompletion(), api: { readLayerPng, writeLayerPng } as any, projectRef: f.projectRef, folderPath: f.folder, bitmapLayerWriteQueueRef: { current: createBitmapLayerWriteQueue() }, createHistoryEntryFromLayerAssets: () => ({}), recordUndoEntry: () => {}, markShotsDirty: () => {}, updateProject: f.update });
    await c.handleBitmapSelectionTransform(f.projectRef.current.shots[0], "l", blue);
    const t = f.projectRef.current.pendingBake!.shots.s.editToken;
    expect(t).not.toBe("initial");
    await c.handleBitmapSelectionTransform(f.projectRef.current.shots[0], "l", blue);
    expect(f.projectRef.current.pendingBake!.shots.s.editToken).not.toBe(t);
    expect(await f.adapter.autosave(f.projectRef.current)).toBe(true);
    await f.adapter.owner.load(async () => (await readProjectMetadata<Project>(f.metadataPath))!);
    expect(f.projectRef.current.pendingBake!.shots.s.state).toBe("pending");
    const output = await writePhotoshopLayeredTiffsForInPlaceSave(f.projectRef.current, f.folder, { saveStamp: "m3a-output", scriptPath: path.join(process.cwd(), "scripts/photoshop-layered-tiff-export.py") });
    const pixels = await sharp(output.replacements[0].fromPath).ensureAlpha().raw().toBuffer();
    expect([...pixels.subarray(0, 4)]).toEqual([0, 0, 255, 255]);
    expect(await hash(f.projectRef.current.shots[0].imagePath)).toBe(f.initial.pendingBake!.shots.s.acceptedOutputIdentity);
    const beforeFailure = f.projectRef.current.pendingBake!.shots.s;
    const bitmapPath = path.join(f.folder, f.projectRef.current.shots[0].layers![0].bitmapPath);
    const beforePixels = await readFile(bitmapPath);
    const failing = useBitmapLayerPaintingController({ captureWorkspace: () => f.adapter.owner.captureEffectAdmission(), captureEffectCompletion: () => f.adapter.owner.captureEffectCompletion(), api: { readLayerPng, writeLayerPng: async () => { throw new Error("fixture write fault"); } } as any, projectRef: f.projectRef, folderPath: f.folder, bitmapLayerWriteQueueRef: { current: createBitmapLayerWriteQueue() }, createHistoryEntryFromLayerAssets: () => ({}), recordUndoEntry: () => {}, markShotsDirty: () => {}, updateProject: f.update });
    await expect(failing.handleBitmapSelectionTransform(f.projectRef.current.shots[0], "l", blue)).rejects.toThrow("fixture write fault");
    // The real production completion capability treats an unacknowledged
    // writer rejection as uncertain, not as a trusted no-effect response.
    expect(f.projectRef.current.pendingBake!.shots.s).toMatchObject({ state: "unknown", acceptedOutputIdentity: beforeFailure.acceptedOutputIdentity });
    expect(f.projectRef.current.pendingBake!.shots.s.editToken).toBeUndefined();
    expect(await readFile(bitmapPath)).toEqual(beforePixels);
    expect(f.adapter.owner.captureEffectAdmission()()).toBe(false);
    expect(await f.adapter.autosave(f.projectRef.current)).toBe(false);
    expect(await f.adapter.save()).toBe(false);
  } finally { await f.cleanup(); }
});
it("not-ready load failure refuses edit/init/autosave/Save instead of falling back to old Project", async () => {
  const f = await fixture(); try {
    const old = f.projectRef.current;
    await expect(f.adapter.owner.load(async () => { throw new Error("reader fault"); })).rejects.toThrow("reader fault");
    expect(f.adapter.owner.publishEdit({ ...old, name: "not published" }, ["s"])).toBe(false);
    expect(await f.adapter.owner.publishNewShot(p => ({ ...p, shots: [...p.shots, { ...p.shots[0], id: "no" }] }), "no", () => true)).toBe(false);
    expect(await f.adapter.autosave(old)).toBe(false);
    expect(await f.adapter.save()).toBe(false);
    expect(f.projectRef.current).toBe(old);
    await f.adapter.owner.load(async () => ({ ...createProject("empty"), pendingBake: { version: 1, shots: {} } }));
    expect(await f.adapter.autosave(f.projectRef.current)).toBe(true);
    expect((await readProjectMetadata<Project>(f.metadataPath))!.pendingBake).toEqual({ version: 1, shots: {} });
  } finally { await f.cleanup(); }
});
it("actual scene matte/resize and caption callers publish tokens through real assets and JSON reload", async () => {
  const f = await fixture(); try {
    const { createShotPresentationController } = await import("./shotPresentationController");
    const { readLayerAssetSnapshots } = await import("./bitmapLayerHistory");
    const { readLayerPng, writeLayerPng, deleteLayerPng } = await import("../../electron/main/layerAssetService");
    const { writePhotoshopLayeredTiffsForInPlaceSave } = await import("../../electron/main/photoshopTiffExport");
    const dataUrl = (b: Buffer) => `data:image/png;base64,${b.toString("base64")}`;
    await sharp({ create: { width: 8, height: 1080, channels: 4, background: "red" } }).png().toFile(path.join(f.folder, f.initial.shots[0].layers![0].bitmapPath));
    f.update((p: Project) => ({ ...p, dialogues: [{ id: "d", shotId: "s", order: 0, text: "Caption" }], shots: p.shots.map(s => ({ ...s, swb: { ...s.swb!, canvasHeight: 1080 }, layers: s.layers!.map(l => ({ ...l, height: 1080 })) })) }));
    // The existing controller has explicit raster ports: use real sharp PNGs at this boundary,
    // not fake filesystem ACKs. This does not certify browser typography/canvas rendering.
    const transparent = dataUrl(await sharp({ create: { width: 8, height: 1230, channels: 4, background: "transparent" } }).png().toBuffer());
    const api = { readLayerPng, writeLayerPng, deleteLayerPng, ensureLayerAssets: async () => { for (const s of f.projectRef.current.shots) for (const l of s.layers ?? []) await readFile(path.join(f.folder, l.bitmapPath)); } } as any;
    const c = createShotPresentationController({ api, bitmapLayerWriteQueueRef: { current: createBitmapLayerWriteQueue() }, createHistoryEntry: async paths => ({ project: f.projectRef.current, fileNameSyncState: "unsynced", selectedShotIds: [], layerAssets: await readLayerAssetSnapshots(api, f.folder, paths ?? []) }),
      expandBitmapLayer: async (source, _layer, top, bottom) => dataUrl(await sharp(Buffer.from(source.split(",")[1], "base64")).extend({ top, bottom, left: 0, right: 0, background: "transparent" }).png().toBuffer()),
      createMatteOverlay: (w, h) => { expect([w, h]).toEqual([8, 1230]); return transparent; },
      createDialogueOverlay: (w, h, _top, text) => { expect([w, h, text]).toEqual([8, 1230, "Caption"]); return transparent; },
      folderPath: f.folder, metadataPath: f.metadataPath, projectRef: f.projectRef, markShotsDirty: () => {}, recordUndoEntry: () => {}, setStatus: () => {}, shotPresentationActionRef: { current: undefined }, updateProject: f.update });
    const before = f.projectRef.current.pendingBake!.shots.s.editToken;
    await c.handleSetShotMatteMode("expanded");
    expect(f.projectRef.current.shots[0].swb!.canvasHeight).toBe(1230);
    expect(f.projectRef.current.pendingBake!.shots.s.editToken).not.toBe(before);
    const matteToken = f.projectRef.current.pendingBake!.shots.s.editToken;
    await c.handlePlaceDialogueOnMatte();
    expect(f.projectRef.current.pendingBake!.shots.s.editToken).not.toBe(matteToken);
    expect(f.projectRef.current.shots[0].layers!.at(-1)!.id).toBe("layer-dialogue-overlay");
    expect(await f.adapter.autosave(f.projectRef.current)).toBe(true);
    await f.adapter.owner.load(async () => (await readProjectMetadata<Project>(f.metadataPath))!);
    expect(f.projectRef.current.shots[0].swb!.canvasHeight).toBe(1230);
    const output = await writePhotoshopLayeredTiffsForInPlaceSave(f.projectRef.current, f.folder, { saveStamp: "m3a-matte", scriptPath: path.join(process.cwd(), "scripts/photoshop-layered-tiff-export.py") });
    const dimensions = await sharp(output.replacements[0].fromPath).metadata();
    expect([dimensions.width, dimensions.height]).toEqual([8, 1230]);
    expect(f.projectRef.current.pendingBake!.shots.s.acceptedOutputIdentity).toBe(f.initial.pendingBake!.shots.s.acceptedOutputIdentity);
  } finally { await f.cleanup(); }
});
it("actual common edit preserves baseline/extensions, but changed source lineage becomes unknown", async () => {
  const f = await fixture(); try {
    const before = f.projectRef.current.pendingBake!.shots.s;
    f.update((p: Project) => ({ ...p, shots: p.shots.map(s => ({ ...s, swb: { ...s.swb!, sourcePath: "/different-origin.tiff" } })) }));
    expect(f.projectRef.current.pendingBake!.shots.s.state).toBe("unknown");
    expect(f.projectRef.current.pendingBake!.shots.s.acceptedOutputIdentity).toBe(before.acceptedOutputIdentity);
    expect(await f.adapter.autosave(f.projectRef.current)).toBe(false);
    const raw = { version: 9, shots: {}, future: "keep" };
    f.projectRef.current = { ...f.initial, pendingBake: raw as any };
    f.update((p: Project) => ({ ...p, name: "edit unsupported" }));
    expect(f.projectRef.current.pendingBake).toBe(raw);
    expect(await f.adapter.autosave(f.projectRef.current)).toBe(false);
  } finally { await f.cleanup(); }
});
it("new root hash await cancelled by a new load epoch retains old Project and actual assets", async () => {
  const f = await fixture(); try {
    const imagePath = path.join(f.folder, "cancelled-new.tiff");
    await sharp({ create: { width: 8, height: 6, channels: 4, background: "blue" } }).tiff().toFile(imagePath);
    f.update((p: Project) => ({ ...p, name: "old edited", shots: p.shots.map(s => ({ ...s, layers: [...s.layers!] })) }));
    expect(await f.adapter.autosave(f.projectRef.current)).toBe(true);
    const preserved = f.projectRef.current, before = await hash(imagePath);
    let release!: () => void, entered!: () => void;
    const waiting = new Promise<void>(r => release = r), started = new Promise<void>(r => entered = r);
    const realRead = f.api.readOutputIdentity;
    f.api.readOutputIdentity = async file => { entered(); await waiting; return realRead(file); };
    const publishing = f.adapter.owner.publishNewShot(p => ({ ...p, shots: [...p.shots, { ...p.shots[0], id: "new", imagePath, fileName: "cancelled-new.tiff" }] }), "new", () => true);
    await started;
    expect(await f.adapter.owner.load(createProject("B"))).toBe(true);
    release(); expect(await publishing).toBe(false);
    expect(f.projectRef.current.name).toBe("B");
    expect((await readProjectMetadata<Project>(f.metadataPath))!.pendingBake).toEqual(preserved.pendingBake);
    expect(await hash(imagePath)).toBe(before);
    expect(await hash(preserved.shots[0].imagePath)).toBe(preserved.pendingBake!.shots.s.acceptedOutputIdentity);
  } finally { await f.cleanup(); }
});
it("initializer never replaces unsupported or corrupt raw envelope", () => {
  for (const raw of [{ version: 8, shots: {}, future: "retain" }, { version: 1, shots: null }]) {
    const p = { ...createProject("P"), shots: [{ id: "n", order: 0, fileName: "n.tiff", imagePath: "/n.tiff" }], pendingBake: raw as any };
    expect(initializeCompletedShot(p, "n", "0".repeat(64), "t").pendingBake).toBe(raw);
  }
});

// Executes the actual App.tsx Add asset-api wiring declarations + expression, not a fake.
// Returns the App's own beginAddShotOperation; each call yields THIS Add's own handle
// { api, registerBlankShot } (never a shared "latest" ref).
async function appAddApi(storyboardApi: unknown, adapter: unknown, recoveryRef: { current: string | undefined } = { current: undefined }, paths: { folderPath?: string; metadataPath?: string } = {}) {
  const app = await readFile(new URL("./App.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("App.tsx", app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let apiExpr = "";
  const decls: string[] = [];
  const wanted = new Set(["buildAddShotAssetApi", "beginAddShotOperation"]);
  const walk = (n: ts.Node) => {
    if (ts.isCallExpression(n) && n.expression.getText(ast) === "useAddShotController") {
      const options = n.arguments[0] as ts.ObjectLiteralExpression;
      apiExpr = (options.properties.find(p => (p as ts.PropertyAssignment).name?.getText(ast) === "api") as ts.PropertyAssignment).initializer.getText(ast);
    }
    if (ts.isVariableDeclaration(n) && wanted.has(n.name.getText(ast))) decls.push(`const ${n.getText(ast)};`);
    ts.forEachChild(n, walk);
  };
  walk(ast);
  expect(apiExpr, "App Add asset api binding not found").not.toBe("");
  expect(decls.some(d => d.includes("buildAddShotAssetApi")), "App Add producer api builder not found").toBe(true);
  expect(decls.some(d => d.includes("beginAddShotOperation")), "App Add operation capture not found").toBe(true);
  const folderPathRef = { current: paths.folderPath }, metadataPathRef = { current: paths.metadataPath };
  const bindings = { window: { storyboard: storyboardApi }, normalSaveAppEnabled: true, normalSaveAppAdapterRef: { current: adapter }, workspaceRecoveryRequiredRef: recoveryRef, folderPathRef, metadataPathRef };
  return new Function(...Object.keys(appCallerAdapterScope(bindings)), ts.transpile(`${decls.join("\n")} return { api: (${apiExpr}), beginAddShotOperation };`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(appCallerAdapterScope(bindings))) as { api: any; beginAddShotOperation: () => { api: any; registerBlankShot: (done: { shotId: string }) => void } | undefined };
}
// Extract an actual App.tsx variable/expression (used to drive the real callers under test).
async function appExpression(name: string) {
  const app = await readFile(new URL("./App.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("App.tsx", app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expr = "";
  const walk = (n: ts.Node) => { if (ts.isVariableDeclaration(n) && n.name.getText(ast) === name) expr = n.initializer!.getText(ast); ts.forEachChild(n, walk); };
  walk(ast);
  expect(expr, `App declaration ${name} not found`).not.toBe("");
  return expr;
}
// Extract the actual App useAddShotController({ openOwnedFolder }) expression.
async function appOwnedOpenExpression() {
  const app = await readFile(new URL("./App.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("App.tsx", app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expr = "";
  const walk = (n: ts.Node) => {
    if (ts.isCallExpression(n) && n.expression.getText(ast) === "useAddShotController") {
      const options = n.arguments[0] as ts.ObjectLiteralExpression;
      const prop = options.properties.find(p => (p as ts.PropertyAssignment).name?.getText(ast) === "openOwnedFolder") as ts.PropertyAssignment | undefined;
      if (prop) expr = prop.initializer.getText(ast);
    }
    ts.forEachChild(n, walk);
  };
  walk(ast);
  expect(expr, "App openOwnedFolder binding not found").not.toBe("");
  return expr;
}
const waitFor = async (condition: () => boolean) => { for (let i = 0; i < 400; i++) { if (condition()) return; await new Promise(r => setTimeout(r, 5)); } throw new Error("waitFor timed out"); };
const evalAppExpression = (expr: string, bindings: Record<string, unknown>) =>
  new Function(...Object.keys(appCallerAdapterScope(bindings)), ts.transpile(`return (${expr});`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(appCallerAdapterScope(bindings)));
const transparentPng = async (width: number, height: number) => `data:image/png;base64,${(await sharp({ create: { width, height, channels: 4, background: "transparent" } }).png().toBuffer()).toString("base64")}`;
const transparentPngSync = (buffer: Buffer) => `data:image/png;base64,${buffer.toString("base64")}`;
it("actual App Add expanded matte wiring completes through real main files and publishes the pending root token", async () => {
  const f = await fixture(); try {
    const { useAddShotController, prepareAddShotMatte } = await import("./addShotController");
    const { createBlankShot } = await import("../../electron/main/blankShotService");
    const { writeLayerPng, readLayerPng } = await import("../../electron/main/layerAssetService");
    const ensure = await actualEnsure();
    f.update((p: Project) => ({ ...p, shots: p.shots.map(s => ({ ...s, presentation: { matte: { mode: "expanded" as const, top: 75, bottom: 75, sourceHeight: 6 } } })) }));
    const origin = { identity: {}, folderPath: f.folder, metadataPath: f.metadataPath };
    const ensurePayloads: any[] = [];
    const storyboardApi: any = {
      createBlankShot: async (folder: string) => { const imagePath = await createBlankShot(folder, "16:9"); return { imagePath, fileName: path.basename(imagePath), width: 1920, height: 1080 }; },
      writeLayerPng, readLayerPng, ensureLayerAssets: async (payload: any) => { ensurePayloads.push(payload); await ensure(payload.project, payload.folderPath); return payload; }
    };
    const { api, beginAddShotOperation } = await appAddApi(storyboardApi, f.adapter, undefined, { folderPath: f.folder, metadataPath: f.metadataPath });
    const overlay = transparentPngSync(await sharp({ create: { width: 1920, height: 1230, channels: 4, background: "transparent" } }).png().toBuffer());
    const statuses: string[] = [];
    const c = useAddShotController({ isImageImportLocked: () => false, beginAddShotOperation, api, blankShotPreset: "16:9", captureWorkspace: () => origin, isCurrentWorkspace: (r: object) => r === origin,
      createTransparentLayerDataUrl: transparentPng,
      folderPath: f.folder, metadataPath: f.metadataPath, primarySelectedShotId: "s", projectRef: f.projectRef, loadFolderScan: async () => undefined,
      inheritSceneMatte: async (p: Project, mode: "expanded" | "embedded", ids: string[], request: any) => prepareAddShotMatte(p, mode, ids, request, { api, queue: createBitmapLayerWriteQueue(), canvas: {
        expandBitmapLayer: async (source, _layer, top, bottom) => `data:image/png;base64,${(await sharp(Buffer.from(source.split(",")[1], "base64")).extend({ top, bottom, left: 0, right: 0, background: "transparent" }).png().toBuffer()).toString("base64")}`,
        createMatteOverlay: () => overlay
      } }),
      markShotsDirty: () => {}, selectSingleShot: () => {}, setRecentFolders: () => {}, setStatus: (s: string) => statuses.push(s), setWorkspaceTask: () => {}, updateProject: f.update,
      publishNewShot: (update: (p: Project) => Project, id: string, current: () => boolean) => f.adapter.owner.publishNewShot(update, id, current)
    } as any);
    await c.handleAddShot();
    const added = f.projectRef.current.shots.find(s => s.id !== "s")!;
    expect(added, "Add expanded matte did not publish a new shot: " + JSON.stringify(statuses)).toBeDefined();
    expect(added.presentation?.matte?.mode).toBe("expanded");
    expect(f.projectRef.current.pendingBake!.shots[added.id]).toEqual({ state: "pending", editToken: expect.any(String), acceptedOutputIdentity: await hash(added.imagePath) });
    expect(await f.adapter.autosave(f.projectRef.current)).toBe(true);
    expect((await readProjectMetadata<Project>(f.metadataPath))!.pendingBake!.shots[added.id].state).toBe("pending");
    // The provisional ensure is limited to the newly created shot's own paths; existing
    // shots are never re-ensured through the producer operation.
    expect(ensurePayloads.length).toBeGreaterThan(0);
    for (const payload of ensurePayloads) {
      expect(payload.project.shots.map((s: any) => s.id)).toEqual([added.id]);
      expect(payload.folderPath).toBe(f.folder);
      for (const s of payload.project.shots) {
        expect(path.resolve(f.folder, s.imagePath).startsWith(f.folder + path.sep)).toBe(true);
        for (const l of s.layers ?? []) expect(path.resolve(f.folder, l.bitmapPath).startsWith(f.folder + path.sep)).toBe(true);
      }
    }
    expect(statuses.at(-1)).toMatch(/^Added/);
  } finally { await f.cleanup(); }
});
it("actual App Add wiring does not publish a stale half-completion into a newer workspace", async () => {
  const f = await fixture(); let other: string | undefined;
  try {
    const { useAddShotController, prepareAddShotMatte } = await import("./addShotController");
    const { createBlankShot } = await import("../../electron/main/blankShotService");
    const { writeLayerPng, readLayerPng } = await import("../../electron/main/layerAssetService");
    const ensure = await actualEnsure();
    f.update((p: Project) => ({ ...p, shots: p.shots.map(s => ({ ...s, presentation: { matte: { mode: "expanded" as const, top: 75, bottom: 75, sourceHeight: 6 } } })) }));
    const origin = { identity: {}, folderPath: f.folder, metadataPath: f.metadataPath };
    other = await mkdtemp(path.join(process.env.TMPDIR!, "m3a-newer-"));
    let switched = false, writesAfterSwitch = 0;
    const storyboardApi: any = {
      createBlankShot: async (folder: string) => { const imagePath = await createBlankShot(folder, "16:9"); return { imagePath, fileName: path.basename(imagePath), width: 1920, height: 1080 }; },
      readLayerPng,
      writeLayerPng: async (payload: any) => { if (switched) writesAfterSwitch++; return writeLayerPng(payload); },
      ensureLayerAssets: async (payload: any) => { await ensure(payload.project, payload.folderPath); return payload; }
    };
    const { api, beginAddShotOperation } = await appAddApi(storyboardApi, f.adapter, undefined, { folderPath: f.folder, metadataPath: f.metadataPath });
    const overlay = transparentPngSync(await sharp({ create: { width: 1920, height: 1230, channels: 4, background: "transparent" } }).png().toBuffer());
    const statuses: string[] = [];
    // Faithful App ownership: captureWorkspace/isCurrentWorkspace compare the live identity,
    // which a real load/switch replaces (the adapter epoch alone is not the workspace owner).
    let current = { identity: {}, folderPath: f.folder, metadataPath: f.metadataPath };
    const c = useAddShotController({ isImageImportLocked: () => false, beginAddShotOperation, api, blankShotPreset: "16:9", captureWorkspace: () => current, isCurrentWorkspace: (r: object) => r === current,
      createTransparentLayerDataUrl: transparentPng,
      folderPath: f.folder, metadataPath: f.metadataPath, primarySelectedShotId: "s", projectRef: f.projectRef, loadFolderScan: async () => undefined,
      inheritSceneMatte: async (p: Project, mode: "expanded" | "embedded", ids: string[], request: any) => prepareAddShotMatte(p, mode, ids, request, { api, queue: createBitmapLayerWriteQueue(), canvas: {
        expandBitmapLayer: async (source, _layer, top, bottom) => { switched = true; current = { identity: {}, folderPath: other!, metadataPath: path.join(other!, ".storyboard-workbench/storyboard.project.json") }; await f.adapter.owner.load({ ...createProject("newer"), pendingBake: { version: 1 as const, shots: {} } }); return transparentPngSync((await sharp(Buffer.from(source.split(",")[1], "base64")).extend({ top, bottom, left: 0, right: 0, background: "transparent" }).png().toBuffer())); },
        createMatteOverlay: () => overlay
      } }),
      markShotsDirty: () => {}, selectSingleShot: () => {}, setRecentFolders: () => {}, setStatus: (s: string) => statuses.push(s), setWorkspaceTask: () => {}, updateProject: f.update,
      publishNewShot: (update: (p: Project) => Project, id: string, current: () => boolean) => f.adapter.owner.publishNewShot(update, id, current)
    } as any);
    await c.handleAddShot();
    expect(f.projectRef.current.name).toBe("newer");
    expect(f.projectRef.current.shots.some(s => s.id !== "s")).toBe(false);
    expect(statuses.some(s => /^Added/.test(s))).toBe(false);
    // The scope switch must stop asset writes during the await, not only suppress publication.
    expect(writesAfterSwitch).toBe(0);
    expect(await readdir(other!)).toEqual([]);
  } finally { if (other) await rm(other, { recursive: true, force: true }); await f.cleanup(); }
});
it.each(["unknown", "future", "corrupt"] as const)("actual App Add refuses %s owner state before the first blank-TIFF effect", async state => {
  const f = await fixture(); try {
    const { useAddShotController } = await import("./addShotController");
    const { createBlankShot } = await import("../../electron/main/blankShotService");
    const { writeLayerPng, readLayerPng } = await import("../../electron/main/layerAssetService");
    const bad = state === "future" ? { version: 99, shots: {} } : state === "corrupt" ? { version: 1, shots: null } : { version: 1, shots: { s: { state: "unknown" } } };
    f.projectRef.current = { ...f.initial, pendingBake: bad as any };
    await f.adapter.owner.load(f.projectRef.current);
    const origin = { identity: {}, folderPath: f.folder, metadataPath: f.metadataPath };
    let realCalls = 0;
    const storyboardApi: any = {
      createBlankShot: async (folder: string) => { realCalls++; const imagePath = await createBlankShot(folder, "16:9"); return { imagePath, fileName: path.basename(imagePath), width: 1920, height: 1080 }; },
      writeLayerPng, readLayerPng, ensureLayerAssets: async (payload: any) => payload
    };
    const { api, beginAddShotOperation } = await appAddApi(storyboardApi, f.adapter, undefined, { folderPath: f.folder, metadataPath: f.metadataPath });
    const statuses: string[] = [];
    const before = await readdir(f.folder);
    const c = useAddShotController({ isImageImportLocked: () => false, beginAddShotOperation, api, blankShotPreset: "16:9", captureWorkspace: () => origin, isCurrentWorkspace: (r: object) => r === origin,
      createTransparentLayerDataUrl: transparentPng,
      folderPath: f.folder, metadataPath: f.metadataPath, primarySelectedShotId: "s", projectRef: f.projectRef, loadFolderScan: async () => undefined,
      inheritSceneMatte: async (p: Project) => p,
      markShotsDirty: () => {}, selectSingleShot: () => {}, setRecentFolders: () => {}, setStatus: (s: string) => statuses.push(s), setWorkspaceTask: () => {}, updateProject: f.update,
      publishNewShot: (update: (p: Project) => Project, id: string, current: () => boolean) => f.adapter.owner.publishNewShot(update, id, current)
    } as any);
    await c.handleAddShot();
    expect(realCalls, "blank TIFF created for a not-ready owner").toBe(0);
    expect(await readdir(f.folder)).toEqual(before);
    expect(f.projectRef.current.shots.some(s => s.id !== "s")).toBe(false);
    expect(statuses.some(s => /^Added/.test(s))).toBe(false);
    expect(f.projectRef.current.pendingBake).toEqual(bad);
  } finally { await f.cleanup(); }
});
it("actual App Add refuses a pending recovery before the first blank-TIFF effect", async () => {
  const f = await fixture(); try {
    const { useAddShotController } = await import("./addShotController");
    const { createBlankShot } = await import("../../electron/main/blankShotService");
    const { writeLayerPng, readLayerPng } = await import("../../electron/main/layerAssetService");
    const origin = { identity: {}, folderPath: f.folder, metadataPath: f.metadataPath };
    let realCalls = 0;
    const storyboardApi: any = {
      createBlankShot: async (folder: string) => { realCalls++; const imagePath = await createBlankShot(folder, "16:9"); return { imagePath, fileName: path.basename(imagePath), width: 1920, height: 1080 }; },
      writeLayerPng, readLayerPng, ensureLayerAssets: async (payload: any) => payload
    };
    const { api, beginAddShotOperation } = await appAddApi(storyboardApi, f.adapter, { current: "Image Import incomplete; recovery required" }, { folderPath: f.folder, metadataPath: f.metadataPath });
    const statuses: string[] = [];
    const before = await readdir(f.folder);
    const c = useAddShotController({ isImageImportLocked: () => false, beginAddShotOperation, api, blankShotPreset: "16:9", captureWorkspace: () => origin, isCurrentWorkspace: (r: object) => r === origin,
      createTransparentLayerDataUrl: transparentPng,
      folderPath: f.folder, metadataPath: f.metadataPath, primarySelectedShotId: "s", projectRef: f.projectRef, loadFolderScan: async () => undefined,
      inheritSceneMatte: async (p: Project) => p,
      markShotsDirty: () => {}, selectSingleShot: () => {}, setRecentFolders: () => {}, setStatus: (s: string) => statuses.push(s), setWorkspaceTask: () => {}, updateProject: f.update,
      publishNewShot: (update: (p: Project) => Project, id: string, current: () => boolean) => f.adapter.owner.publishNewShot(update, id, current)
    } as any);
    await c.handleAddShot();
    expect(realCalls).toBe(0);
    expect(await readdir(f.folder)).toEqual(before);
    expect(f.projectRef.current.shots.some(s => s.id !== "s")).toBe(false);
    expect(statuses.some(s => /^Added/.test(s))).toBe(false);
  } finally { await f.cleanup(); }
});
it("actual App Add refuses while the owner is still loading before the first blank-TIFF effect", async () => {
  const f = await fixture(); try {
    const { useAddShotController } = await import("./addShotController");
    const { createBlankShot } = await import("../../electron/main/blankShotService");
    const { writeLayerPng, readLayerPng } = await import("../../electron/main/layerAssetService");
    const origin = { identity: {}, folderPath: f.folder, metadataPath: f.metadataPath };
    let realCalls = 0;
    const storyboardApi: any = {
      createBlankShot: async (folder: string) => { realCalls++; const imagePath = await createBlankShot(folder, "16:9"); return { imagePath, fileName: path.basename(imagePath), width: 1920, height: 1080 }; },
      writeLayerPng, readLayerPng, ensureLayerAssets: async (payload: any) => payload
    };
    const { api, beginAddShotOperation } = await appAddApi(storyboardApi, f.adapter, undefined, { folderPath: f.folder, metadataPath: f.metadataPath });
    let release!: () => void; const gate = new Promise<void>(r => release = r);
    const loading = f.adapter.owner.load(async () => { await gate; return f.initial; });
    const statuses: string[] = [];
    const before = await readdir(f.folder);
    const c = useAddShotController({ isImageImportLocked: () => false, beginAddShotOperation, api, blankShotPreset: "16:9", captureWorkspace: () => origin, isCurrentWorkspace: (r: object) => r === origin,
      createTransparentLayerDataUrl: transparentPng,
      folderPath: f.folder, metadataPath: f.metadataPath, primarySelectedShotId: "s", projectRef: f.projectRef, loadFolderScan: async () => undefined,
      inheritSceneMatte: async (p: Project) => p,
      markShotsDirty: () => {}, selectSingleShot: () => {}, setRecentFolders: () => {}, setStatus: (s: string) => statuses.push(s), setWorkspaceTask: () => {}, updateProject: f.update,
      publishNewShot: (update: (p: Project) => Project, id: string, current: () => boolean) => f.adapter.owner.publishNewShot(update, id, current)
    } as any);
    await c.handleAddShot();
    release(); await loading;
    expect(realCalls, "blank TIFF created while the owner was loading").toBe(0);
    expect(await readdir(f.folder)).toEqual(before);
    expect(statuses.some(s => /^Added/.test(s))).toBe(false);
  } finally { await f.cleanup(); }
});

it("actual App Add operation handle never rebases to a newer ready workspace and cannot borrow another Add's handle", async () => {
  const f = await fixture(); let other: string | undefined;
  try {
    const { createBlankShot } = await import("../../electron/main/blankShotService");
    const { writeLayerPng, readLayerPng } = await import("../../electron/main/layerAssetService");
    const ensure = await actualEnsure();
    let realCalls = 0, writes = 0;
    const storyboardApi: any = {
      createBlankShot: async (folder: string) => { realCalls++; const imagePath = await createBlankShot(folder, "16:9"); return { imagePath, fileName: path.basename(imagePath), width: 1920, height: 1080 }; },
      writeLayerPng: async (payload: any) => { writes++; return writeLayerPng(payload); }, readLayerPng,
      ensureLayerAssets: async (payload: any) => { writes++; await ensure(payload.project, payload.folderPath); return payload; }
    };
    const { beginAddShotOperation } = await appAddApi(storyboardApi, f.adapter, undefined, { folderPath: f.folder, metadataPath: f.metadataPath });
    const op1 = beginAddShotOperation()!;
    // A newer, fully ready workspace loads (new owner instance): op1 (held locally by this Add)
    // must not borrow the new scope. Capture is not a per-call rebase.
    await f.adapter.owner.load({ ...createProject("newer ready"), pendingBake: { version: 1 as const, shots: {} } });
    const before = await readdir(f.folder);
    // The operation-bound api refuses before the underlying effect; createBlankShot is async now.
    await expect(op1.api.createBlankShot(f.folder, { preset: "16:9" })).rejects.toThrow(/instance changed/);
    expect(() => op1.api.writeLayerPng({ folderPath: f.folder, bitmapPath: ".storyboard-workbench/layers/new/l.png", dataUrl: "data:image/png;base64,iVBORw0KGgo=" })).toThrow(/instance changed/);
    expect(() => op1.api.ensureLayerAssets({ project: { ...f.initial, shots: [{ ...f.initial.shots[0], id: "new" }] }, folderPath: f.folder, metadataPath: f.metadataPath })).toThrow(/instance changed/);
    expect(realCalls).toBe(0); expect(writes).toBe(0);
    expect(await readdir(f.folder)).toEqual(before);
    // A fresh Add begun against the new workspace gets its OWN handle that admits normally.
    const op2 = beginAddShotOperation()!;
    expect(op2).not.toBe(op1);
    const blank = await op2.api.createBlankShot(f.folder, { preset: "16:9" });
    expect(blank.imagePath.startsWith(f.folder + path.sep)).toBe(true);
    expect(realCalls).toBe(1);
  } finally { if (other) await rm(other, { recursive: true, force: true }); await f.cleanup(); }
});
it("actual App Add registers only its own recorded blank completion and refuses unregistered, borrowed, existing, traversal, multiple and repeat assets before any effect", async () => {
  const f = await fixture(); let other: string | undefined;
  try {
    const { writeLayerPng, readLayerPng } = await import("../../electron/main/layerAssetService");
    const { createBlankShot } = await import("../../electron/main/blankShotService");
    const ensure = await actualEnsure();
    let writes = 0;
    const storyboardApi: any = {
      createBlankShot: async (folder: string) => { const imagePath = await createBlankShot(folder, "16:9"); return { imagePath, fileName: path.basename(imagePath), width: 1920, height: 1080 }; },
      writeLayerPng: async (payload: any) => { writes++; return writeLayerPng(payload); }, readLayerPng,
      ensureLayerAssets: async (payload: any) => { writes++; await ensure(payload.project, payload.folderPath); return payload; }
    };
    const { beginAddShotOperation } = await appAddApi(storyboardApi, f.adapter, undefined, { folderPath: f.folder, metadataPath: f.metadataPath });
    const op = beginAddShotOperation()!;
    other = await mkdtemp(path.join(process.env.TMPDIR!, "m3a-wrong-"));
    const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const layer = f.initial.shots[0].layers![0];
    // Wrong folder: the source is not the captured operation workspace.
    expect(() => op.api.writeLayerPng({ folderPath: other, bitmapPath: ".storyboard-workbench/layers/new/l.png", dataUrl })).toThrow(/wrong folder/);
    // Unregistered new shot id: this operation has not registered a blank yet.
    expect(() => op.api.writeLayerPng({ folderPath: f.folder, bitmapPath: ".storyboard-workbench/layers/new/l.png", dataUrl })).toThrow(/registered/);
    expect(() => op.api.ensureLayerAssets({ project: { ...f.initial, shots: [{ ...f.initial.shots[0], id: "new" }] }, folderPath: f.folder, metadataPath: f.metadataPath })).toThrow(/registered/);
    // (1) Register without any recorded completion is refused: a caller cannot forge the fact.
    expect(() => op.registerBlankShot({ shotId: "new" })).toThrow(/no blank completion/);
    // (2) Another operation cannot borrow this one's blank: it has no completion of its own.
    const borrower = beginAddShotOperation()!;
    expect(() => borrower.registerBlankShot({ shotId: "borrow" })).toThrow(/no blank completion/);
    // (3) An existing TIFF cannot be certified as a new blank: the operation-bound api refuses at
    // the real record step because the underlying producer returned an existing shot's path.
    const existingApi: any = { createBlankShot: async () => ({ imagePath: f.initial.shots[0].imagePath, fileName: "s.tiff", width: 8, height: 6 }), writeLayerPng, readLayerPng, ensureLayerAssets: async (p: any) => p };
    const existing = await appAddApi(existingApi, f.adapter, undefined, { folderPath: f.folder, metadataPath: f.metadataPath });
    await expect(existing.beginAddShotOperation()!.api.createBlankShot(f.folder, { preset: "16:9" })).rejects.toThrow(/existing TIFF/);
    // (4) A `..` traversal path is refused by the normalize/relative check, not a raw prefix.
    const traversalApi: any = { createBlankShot: async () => ({ imagePath: `${f.folder}/../outside/new.tiff`, fileName: "new.tiff", width: 8, height: 6 }), writeLayerPng, readLayerPng, ensureLayerAssets: async (p: any) => p };
    const traversal = await appAddApi(traversalApi, f.adapter, undefined, { folderPath: f.folder, metadataPath: f.metadataPath });
    await expect(traversal.beginAddShotOperation()!.api.createBlankShot(f.folder, { preset: "16:9" })).rejects.toThrow(/outside the operation folder/);
    // The actual real blank this operation produced is the ONLY registrable fact.
    const blank = await op.api.createBlankShot(f.folder, { preset: "16:9" });
    op.registerBlankShot({ shotId: "new" });
    // (5) Registering twice is refused (once).
    expect(() => op.registerBlankShot({ shotId: "again" })).toThrow(/already registered/);
    // Multiple new ids in one payload are refused.
    expect(() => op.api.ensureLayerAssets({ project: { ...f.initial, shots: [
      { ...f.initial.shots[0], id: "new", imagePath: blank.imagePath, layers: [{ ...layer, bitmapPath: ".storyboard-workbench/layers/new/l.png" }] },
      { ...f.initial.shots[0], id: "extra", imagePath: path.join(f.folder, "extra.tiff"), layers: [{ ...layer, bitmapPath: ".storyboard-workbench/layers/extra/l.png" }] }
    ] }, folderPath: f.folder, metadataPath: f.metadataPath })).toThrow(/only the registered new shot/);
    // A different (borrowed) image path is refused even for the registered id.
    expect(() => op.api.ensureLayerAssets({ project: { ...f.initial, shots: [{ ...f.initial.shots[0], id: "new", imagePath: f.initial.shots[0].imagePath, layers: [{ ...layer, bitmapPath: ".storyboard-workbench/layers/new/l.png" }] }] }, folderPath: f.folder, metadataPath: f.metadataPath })).toThrow(/registered image path/);
    // A layer outside the registered shot's own directory is refused.
    expect(() => op.api.ensureLayerAssets({ project: { ...f.initial, shots: [{ ...f.initial.shots[0], id: "new", imagePath: blank.imagePath, layers: [{ ...layer, bitmapPath: ".storyboard-workbench/layers/other/l.png" }] }] }, folderPath: f.folder, metadataPath: f.metadataPath })).toThrow(/own paths/);
    expect(writes).toBe(0);
  } finally { if (other) await rm(other, { recursive: true, force: true }); await f.cleanup(); }
});

it("actual App Add claims its single blank-request qualification before the real create, so sequential, concurrent and post-failure repeats create exactly one underlying blank", async () => {
  const f = await fixture(); try {
    const { createBlankShot } = await import("../../electron/main/blankShotService");
    const { writeLayerPng, readLayerPng } = await import("../../electron/main/layerAssetService");
    let realCalls = 0, failNext = false;
    let gate: Promise<void> | null = null, releaseGate: (() => void) | null = null;
    const storyboardApi: any = {
      createBlankShot: async (folder: string) => {
        realCalls++;
        if (failNext) { failNext = false; throw new Error("synthetic blank failure"); }
        const imagePath = await createBlankShot(folder, "16:9");
        if (gate) await gate;
        return { imagePath, fileName: path.basename(imagePath), width: 1920, height: 1080 };
      },
      writeLayerPng, readLayerPng, ensureLayerAssets: async (payload: any) => payload
    };
    const { beginAddShotOperation } = await appAddApi(storyboardApi, f.adapter, undefined, { folderPath: f.folder, metadataPath: f.metadataPath });

    // (1) Sequential same handle: the repeat must be refused BEFORE the underlying create, so no
    // second blank TIFF is produced.
    const op = beginAddShotOperation()!;
    await op.api.createBlankShot(f.folder, { preset: "16:9" });
    expect(realCalls).toBe(1);
    await expect(op.api.createBlankShot(f.folder, { preset: "16:9" })).rejects.toThrow(/already/);
    expect(realCalls, "a sequential repeat reached the underlying create").toBe(1);

    // (2) Concurrent same handle while the first blank is still awaited: the second call is refused
    // synchronously, so only one underlying create ever starts.
    const concurrent = beginAddShotOperation()!;
    gate = new Promise<void>(r => { releaseGate = r; });
    const inFlight = concurrent.api.createBlankShot(f.folder, { preset: "16:9" });
    expect(realCalls).toBe(2);
    const second = concurrent.api.createBlankShot(f.folder, { preset: "16:9" });
    expect(realCalls, "a concurrent repeat started a second underlying create").toBe(2);
    await expect(second).rejects.toThrow(/already/);
    releaseGate!(); gate = null;
    await expect(inFlight).resolves.toMatchObject({ imagePath: expect.any(String) });
    expect(realCalls).toBe(2);

    // (3) A failed first request is NOT reset for auto-retry: the qualification stays spent, and a
    // brand-new operation is the only way to retry.
    const failing = beginAddShotOperation()!;
    failNext = true;
    await expect(failing.api.createBlankShot(f.folder, { preset: "16:9" })).rejects.toThrow(/synthetic blank failure/);
    expect(realCalls).toBe(3);
    await expect(failing.api.createBlankShot(f.folder, { preset: "16:9" })).rejects.toThrow(/already/);
    expect(realCalls, "a post-failure retry on the same handle reached the underlying create").toBe(3);
    const fresh = beginAddShotOperation()!;
    const recovered = await fresh.api.createBlankShot(f.folder, { preset: "16:9" });
    expect(realCalls).toBe(4);
    expect(recovered.imagePath.startsWith(f.folder + path.sep)).toBe(true);

    // (4) Two independent handles each get their own single qualification.
    const a = beginAddShotOperation()!, b = beginAddShotOperation()!;
    await a.api.createBlankShot(f.folder, { preset: "16:9" });
    await b.api.createBlankShot(f.folder, { preset: "16:9" });
    expect(realCalls).toBe(6);
    await expect(a.api.createBlankShot(f.folder, { preset: "16:9" })).rejects.toThrow(/already/);
    await expect(b.api.createBlankShot(f.folder, { preset: "16:9" })).rejects.toThrow(/already/);
    expect(realCalls).toBe(6);
  } finally { await f.cleanup(); }
});
it("actual App Add wrong-scope and metadata-P2 refusals do not spend the single blank-request qualification", async () => {
  const f = await fixture(); let other: string | undefined;
  try {
    const { createBlankShot } = await import("../../electron/main/blankShotService");
    const { writeLayerPng, readLayerPng } = await import("../../electron/main/layerAssetService");
    let realCalls = 0;
    const storyboardApi: any = {
      createBlankShot: async (folder: string) => { realCalls++; const imagePath = await createBlankShot(folder, "16:9"); return { imagePath, fileName: path.basename(imagePath), width: 1920, height: 1080 }; },
      writeLayerPng, readLayerPng, ensureLayerAssets: async (payload: any) => payload
    };
    const { beginAddShotOperation } = await appAddApi(storyboardApi, f.adapter, undefined, { folderPath: f.folder, metadataPath: f.metadataPath });
    other = await mkdtemp(path.join(process.env.TMPDIR!, "m3a-claim-"));
    const op = beginAddShotOperation()!;
    // The wrong-folder guard is still the first effect: nothing reaches the underlying create and
    // the wrong scope does not consume the one blank qualification.
    await expect(op.api.createBlankShot(other, { preset: "16:9" })).rejects.toThrow(/wrong folder/);
    expect(realCalls, "a wrong-scope create reached the underlying effect").toBe(0);
    expect(await readdir(other)).toEqual([]);
    // Metadata-only P2 (ensureLayerAssets) stays gated by registration, not cancelled by the claim.
    expect(() => op.api.ensureLayerAssets({ project: { ...f.initial, shots: [{ ...f.initial.shots[0], id: "new" }] }, folderPath: f.folder, metadataPath: f.metadataPath })).toThrow(/registered/);
    // The qualification is intact and the real blank still succeeds exactly once.
    const blank = await op.api.createBlankShot(f.folder, { preset: "16:9" });
    expect(realCalls).toBe(1);
    expect(blank.imagePath.startsWith(f.folder + path.sep)).toBe(true);
    await expect(op.api.createBlankShot(f.folder, { preset: "16:9" })).rejects.toThrow(/already/);
    expect(realCalls).toBe(1);
  } finally { if (other) await rm(other, { recursive: true, force: true }); await f.cleanup(); }
});
it("actual App Add refuses before the first effect while an owner receipt is held, and the receipt survives a later autosave", async () => {
  const f = await fixture(); try {
    const { useAddShotController } = await import("./addShotController");
    const { createBlankShot } = await import("../../electron/main/blankShotService");
    const { writeLayerPng, readLayerPng } = await import("../../electron/main/layerAssetService");
    const imagePath = f.projectRef.current.shots[0].imagePath, h0 = await hash(imagePath);
    const realAutosave = f.api.autosaveWorkspace;
    // A real output succeeds (same accepted whole bytes), then the required JSON/MD persistence
    // fails: Save returns false and leaves an in-process receipt instead of claiming completion.
    f.api.saveWorkspace = (async () => ({ normalSaveOutputs: [{ shotId: "s", capturedToken: "initial", sourcePath: imagePath, targetPath: imagePath, fileName: "s.tiff", outputHash: h0 }] })) as any;
    let persisted = 0;
    f.api.autosaveWorkspace = async () => { persisted++; throw new Error("required persistence failed"); };
    expect(await f.adapter.save()).toBe(false);
    expect(persisted).toBe(1);
    expect(f.projectRef.current.pendingBake!.shots.s.state).toBe("synced");
    // The held receipt still blocks ordinary autosave even after persistence is healthy again.
    f.api.autosaveWorkspace = realAutosave;
    expect(await f.adapter.autosave(f.projectRef.current)).toBe(false);

    const origin = { identity: {}, folderPath: f.folder, metadataPath: f.metadataPath };
    let realCalls = 0, writes = 0;
    const storyboardApi: any = {
      createBlankShot: async (folder: string) => { realCalls++; const blank = await createBlankShot(folder, "16:9"); return { imagePath: blank, fileName: path.basename(blank), width: 1920, height: 1080 }; },
      writeLayerPng: async (payload: any) => { writes++; return writeLayerPng(payload); }, readLayerPng,
      ensureLayerAssets: async (payload: any) => { writes++; return payload; }
    };
    const { api, beginAddShotOperation } = await appAddApi(storyboardApi, f.adapter, undefined, { folderPath: f.folder, metadataPath: f.metadataPath });
    const statuses: string[] = [];
    const before = await readdir(f.folder);
    const c = useAddShotController({ isImageImportLocked: () => false, beginAddShotOperation, api, blankShotPreset: "16:9", captureWorkspace: () => origin, isCurrentWorkspace: (r: object) => r === origin,
      createTransparentLayerDataUrl: transparentPng,
      folderPath: f.folder, metadataPath: f.metadataPath, primarySelectedShotId: "s", projectRef: f.projectRef, loadFolderScan: async () => undefined,
      inheritSceneMatte: async (p: Project) => p,
      markShotsDirty: () => {}, selectSingleShot: () => {}, setRecentFolders: () => {}, setStatus: (s: string) => statuses.push(s), setWorkspaceTask: () => {}, updateProject: f.update,
      publishNewShot: (update: (p: Project) => Project, id: string, current: () => boolean) => f.adapter.owner.publishNewShot(update, id, current)
    } as any);
    await c.handleAddShot();
    expect(realCalls, "blank TIFF created while a receipt was held").toBe(0);
    expect(writes).toBe(0);
    expect(await readdir(f.folder)).toEqual(before);
    expect(f.projectRef.current.shots.some(s => s.id !== "s")).toBe(false);
    expect(statuses.some(s => /^Added/.test(s))).toBe(false);
    // The receipt is still held after the refused Add.
    expect((f.adapter.owner as any).captureAssetScope()()).toBe(false);
    expect(await f.adapter.autosave(f.projectRef.current)).toBe(false);
  } finally { await f.cleanup(); }
});
it.each(["unknown", "retained-transaction"] as const)("actual App Add first-shot folder open (%s) uses the owned open and never the raw legacy path or double load", async (sourceState) => {
  const f = await fixture(); try {
    const { useAddShotController } = await import("./addShotController");
    const origin = { identity: {}, folderPath: undefined, metadataPath: undefined };
    let legacyOpens = 0, effects = 0, manualLoads = 0;
    const chooseApi: any = {
      selectFolder: async () => "/chosen",
      // A fallback here would have run the legacy recovery/preview path; it must never happen.
      openFolderByPath: async () => { legacyOpens++; return { folderPath: "/chosen", folderName: "c", metadataPath: "/chosen/.storyboard-workbench/storyboard.project.json", images: [], ...(sourceState === "retained-transaction" ? { normalSaveOpenRecoveryRequired: "Pending transaction prevents open" } : {}) }; },
      createBlankShot: async () => { effects++; throw new Error("must not create"); },
      writeLayerPng: async () => { effects++; }, readLayerPng: async () => undefined, ensureLayerAssets: async (payload: any) => { effects++; return payload; },
      getRecentFolders: async () => []
    };
    const c = useAddShotController({ beginAddShotOperation: () => undefined, isImageImportLocked: () => false, api: chooseApi, blankShotPreset: "16:9",
      captureWorkspace: () => origin, isCurrentWorkspace: (r: object) => r === origin, createTransparentLayerDataUrl: transparentPng,
      folderPath: undefined, metadataPath: undefined, primarySelectedShotId: undefined, projectRef: f.projectRef,
      loadFolderScan: async () => { manualLoads++; return undefined; }, inheritSceneMatte: async (p: Project) => p,
      markShotsDirty: () => {}, selectSingleShot: () => {}, setRecentFolders: () => {}, setStatus: () => {}, setWorkspaceTask: () => {}, updateProject: f.update,
      publishNewShot: (u: (p: Project) => Project, id: string, cur: () => boolean) => f.adapter.owner.publishNewShot(u, id, cur),
      // Owned open yields nothing (unknown source / retained transaction): zero legacy effects.
      openOwnedFolder: async () => undefined });
    await c.handleAddShot();
    expect(legacyOpens, "raw legacy open used while the owned open was configured").toBe(0);
    expect(manualLoads, "double-loaded via loadFolderScan").toBe(0);
    expect(effects).toBe(0);

    // Flag-off keep: without the owned port the legacy raw branch is still used.
    let legacyOpens2 = 0, manualLoads2 = 0;
    const legacyApi: any = { ...chooseApi, openFolderByPath: async () => { legacyOpens2++; return { folderPath: "/chosen", folderName: "c", metadataPath: "/chosen/.storyboard-workbench/storyboard.project.json", images: [] }; } };
    const c2 = useAddShotController({ isImageImportLocked: () => false, api: legacyApi, blankShotPreset: "16:9",
      captureWorkspace: () => origin, isCurrentWorkspace: (r: object) => r === origin, createTransparentLayerDataUrl: transparentPng,
      folderPath: undefined, metadataPath: undefined, primarySelectedShotId: undefined, projectRef: f.projectRef,
      loadFolderScan: async () => { manualLoads2++; return undefined; }, inheritSceneMatte: async (p: Project) => p,
      markShotsDirty: () => {}, selectSingleShot: () => {}, setRecentFolders: () => {}, setStatus: () => {}, setWorkspaceTask: () => {}, updateProject: f.update,
      publishNewShot: (u: (p: Project) => Project, id: string, cur: () => boolean) => f.adapter.owner.publishNewShot(u, id, cur) });
    await c2.handleAddShot();
    expect(legacyOpens2).toBe(1); expect(manualLoads2).toBe(1);
  } finally { await f.cleanup(); }
});

it("actual App Add register refusal after the blank await (owner loading during the await) is scoped, keeps provisional assets, and never rejects unhandled", async () => {
  const f = await fixture(); try {
    const { useAddShotController } = await import("./addShotController");
    const { createBlankShot } = await import("../../electron/main/blankShotService");
    const { writeLayerPng, readLayerPng } = await import("../../electron/main/layerAssetService");
    const origin = { identity: {}, folderPath: f.folder, metadataPath: f.metadataPath };
    let blankPath = "", created = 0, releaseBlank!: () => void;
    const blankGate = new Promise<void>(r => { releaseBlank = r; });
    const storyboardApi: any = {
      createBlankShot: async (folder: string) => { created++; blankPath = await createBlankShot(folder, "16:9"); await blankGate; return { imagePath: blankPath, fileName: path.basename(blankPath), width: 1920, height: 1080 }; },
      writeLayerPng, readLayerPng, ensureLayerAssets: async (payload: any) => payload
    };
    const { api, beginAddShotOperation } = await appAddApi(storyboardApi, f.adapter, undefined, { folderPath: f.folder, metadataPath: f.metadataPath });
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    process.on("unhandledRejection", onRejection);
    const statuses: string[] = [];
    const c = useAddShotController({ isImageImportLocked: () => false, beginAddShotOperation, api, blankShotPreset: "16:9", captureWorkspace: () => origin, isCurrentWorkspace: (r: object) => r === origin,
      createTransparentLayerDataUrl: transparentPng,
      folderPath: f.folder, metadataPath: f.metadataPath, primarySelectedShotId: "s", projectRef: f.projectRef, loadFolderScan: async () => undefined,
      inheritSceneMatte: async (p: Project) => p,
      markShotsDirty: () => {}, selectSingleShot: () => {}, setRecentFolders: () => {}, setStatus: (s: string) => statuses.push(s), setWorkspaceTask: () => {}, updateProject: f.update,
      publishNewShot: (u: (p: Project) => Project, id: string, cur: () => boolean) => f.adapter.owner.publishNewShot(u, id, cur)
    } as any);
    const task = c.handleAddShot();
    await waitFor(() => created === 1);
    // While the real blank is in flight (already created), a newer load makes THIS operation stale:
    // its recorded completion is kept, but register must be refused inside the operation scope.
    let releaseLoad!: (p: Project) => void;
    const loadGate = new Promise<Project>(r => { releaseLoad = r; });
    const loading = f.adapter.owner.load(async () => loadGate);
    releaseBlank();
    await task;
    await new Promise(r => setImmediate(r));
    process.off("unhandledRejection", onRejection);
    expect(rejections).toEqual([]);
    expect(f.projectRef.current.shots.some(s => s.id !== "s")).toBe(false);
    expect(statuses.some(s => /^Added/.test(s))).toBe(false);
    // The provisional blank asset is preserved (no cleanup driven by live JSON references).
    expect(await readdir(f.folder)).toContain(path.basename(blankPath));
    releaseLoad({ ...createProject("later"), pendingBake: { version: 1 as const, shots: {} } });
    await loading;
  } finally { await f.cleanup(); }
});

it("actual App owned open returns the FINAL owner Project bound to its own request epoch, never the scan snapshot", async () => {
  const f = await fixture(); try {
    const aiApply = { current: undefined as object | undefined };
    const errors: unknown[] = [];
    let publishedProject: Project | undefined;
    const { createAppOpenCallerScope } = await import('../../electron/main/appOpenCallerScope.mjs');
    const api: any = {
      openFolderByPath: async (_p: string, _o: unknown) => ({ folderPath: f.folder, folderName: "P", metadataPath: f.metadataPath, images: [], project: f.initial }),
      autosaveWorkspace: async () => ({}), saveWorkspace: async () => ({}), readOutputIdentity: async (file: string) => hash(file)
    };
    const caller = await createAppOpenCallerScope({ projectRef: f.projectRef, setProject: () => {}, queue: createBitmapLayerWriteQueue(), freshToken: () => 't', api: () => api, paths: () => ({folderPath:f.folder,metadataPath:f.metadataPath}), onSave: () => {}, onError: (e: unknown) => errors.push(e) }, false, false,
      {publishScan: (_scan: unknown, project: Project) => { publishedProject=project;aiApply.current={};caller.workspaceSlotsRef.current.active.adapter.owner.publishEdit((p: Project)=>({...p,name:'FINAL'}),[]); }});
    const adapter = caller.renderAdapter;
    const expr = await appOwnedOpenExpression();
    const open = evalAppExpression(expr, {
      ...caller,
      window: { storyboard: api }, normalSaveAppEnabled: true, normalSaveAppAdapterRef: { current: adapter },
      // The actual publish callback changes the owner Project AFTER onLoaded; success must return
      // that FINAL Project, not the snapshot handed to the callback.
      publishNormalSaveFolderScan: (_scan: unknown, project: Project) => { publishedProject = project; aiApply.current = {}; adapter.owner.publishEdit((p: Project) => ({ ...p, name: "FINAL" }), []); },
      blankShotPreset: "16:9", dirtyShotIds: () => [], prepareNormalSaveImportMatte: async (p: Project) => p, normalSaveImageImportPublished: () => {}, aiApplyWorkspaceIdentityRef: aiApply
    }) as (target: string) => Promise<{ project?: Project; loaded: boolean; identity: object } | undefined>;
    const result = await open(f.folder);
    expect(errors).toEqual([]);
    expect(result?.loaded).toBe(true);
    expect(result?.project?.name).toBe("FINAL");
    expect(result?.project).toBe(f.projectRef.current);
    expect(result?.project).not.toBe(publishedProject);
  } finally { await f.cleanup(); }
});

it("actual App plain open does not publish an incomplete status into a superseded same-path scope", async () => {
  const f = await fixture(); try {
    const errors: unknown[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>(r => { releaseFirst = r; });
    let calls = 0;
    const api: any = {
      openFolderByPath: async (_p: string, _o: unknown) => { calls++; if (calls === 1) await firstGate; return { folderPath: f.folder, folderName: "P", metadataPath: f.metadataPath, images: [], project: f.initial }; },
      autosaveWorkspace: async () => ({}), saveWorkspace: async () => ({}), readOutputIdentity: async (file: string) => hash(file)
    };
    const adapter = createNormalSaveAppAdapter({ projectRef: f.projectRef, setProject: p => { f.projectRef.current = p; }, queue: createBitmapLayerWriteQueue(), freshToken: () => "t", api: () => api, paths: () => ({ folderPath: f.folder, metadataPath: f.metadataPath }), onSave: () => {}, onError: e => errors.push(e) });
    const statuses: string[] = [];
    const expr = await appExpression("handleOpenFolderByPath");
    const { createAppOpenCallerScope } = await import('../../electron/main/appOpenCallerScope.mjs');
    const caller = await createAppOpenCallerScope({projectRef:f.projectRef,setProject:()=>{},queue:createBitmapLayerWriteQueue(),freshToken:()=> 't',api:()=>api,paths:()=>({folderPath:f.folder,metadataPath:f.metadataPath}),onSave:()=>{},onError:(e:unknown)=>errors.push(e)});
    const open = evalAppExpression(expr, {
      ...caller,
      window: { storyboard: api }, normalSaveAppEnabled: true, normalSaveAppAdapterRef: { current: adapter }, folderInputValue: f.folder,
      blankShotPreset: "16:9", prepareNormalSaveImportMatte: async (p: Project) => p, normalSaveImageImportPublished: () => {},
      publishNormalSaveFolderScan: () => {}, setWorkspaceTask: () => {}, setStatus: (s: string) => statuses.push(s)
    }) as (pathOverride?: string) => Promise<void>;
    // A newer same-path request rotates the owner epoch and supersedes the first request.
    const first = open(f.folder);
    const second = open(f.folder);
    releaseFirst();
    await Promise.all([first, second]);
    expect(statuses).not.toContain("Open folder failed: output initialization incomplete");
    expect(errors).toEqual([]);
  } finally { await f.cleanup(); }
});

it("actual App owned open with a failed load yields zero Add effects", async () => {
  const f = await fixture(); try {
    const { useAddShotController } = await import("./addShotController");
    const { createBlankShot } = await import("../../electron/main/blankShotService");
    const { writeLayerPng, readLayerPng } = await import("../../electron/main/layerAssetService");
    const aiApply = { current: undefined as object | undefined };
    const errors: unknown[] = [];
    let blankCalls = 0;
    const api: any = {
      selectFolder: async () => f.folder,
      openFolderByPath: async () => { throw new Error("synthetic open failure"); },
      getRecentFolders: async () => [],
      createBlankShot: async (folder: string) => { blankCalls++; const imagePath = await createBlankShot(folder, "16:9"); return { imagePath, fileName: path.basename(imagePath), width: 1920, height: 1080 }; },
      writeLayerPng, readLayerPng, ensureLayerAssets: async (p: any) => p,
      autosaveWorkspace: async () => ({}), saveWorkspace: async () => ({}), readOutputIdentity: async (file: string) => hash(file)
    };
    const adapter = createNormalSaveAppAdapter({ projectRef: f.projectRef, setProject: p => { f.projectRef.current = p; }, queue: createBitmapLayerWriteQueue(), freshToken: () => "t", api: () => api, paths: () => ({ folderPath: f.folder, metadataPath: f.metadataPath }), onSave: () => {}, onError: e => errors.push(e) });
    const expr = await appOwnedOpenExpression();
    const { createAppOpenCallerScope } = await import('../../electron/main/appOpenCallerScope.mjs');
    const caller = await createAppOpenCallerScope({projectRef:f.projectRef,setProject:()=>{},queue:createBitmapLayerWriteQueue(),freshToken:()=> 't',api:()=>api,paths:()=>({folderPath:f.folder,metadataPath:f.metadataPath}),onSave:()=>{},onError:(e:unknown)=>errors.push(e)});
    const openOwnedFolder = evalAppExpression(expr, {
      ...caller,
      window: { storyboard: api }, normalSaveAppEnabled: true, normalSaveAppAdapterRef: { current: adapter },
      publishNormalSaveFolderScan: () => { aiApply.current = {}; },
      blankShotPreset: "16:9", dirtyShotIds: () => [], prepareNormalSaveImportMatte: async (p: Project) => p, normalSaveImageImportPublished: () => {}, aiApplyWorkspaceIdentityRef: aiApply
    }) as (target: string) => Promise<unknown>;
    // The controller drives the ACTUAL App openOwnedFolder callback (real adapter): a failed load
    // (loaded !== true) must not continue into any Add effect.
    const origin = { identity: {}, folderPath: undefined, metadataPath: undefined };
    const statuses: string[] = [];
    const c = useAddShotController({ isImageImportLocked: () => false, api, blankShotPreset: "16:9", captureWorkspace: () => origin, isCurrentWorkspace: (r: object) => r === origin,
      createTransparentLayerDataUrl: transparentPng, folderPath: undefined, metadataPath: undefined, primarySelectedShotId: undefined, projectRef: f.projectRef, loadFolderScan: async () => undefined,
      inheritSceneMatte: async (p: Project) => p, markShotsDirty: () => {}, selectSingleShot: () => {}, setRecentFolders: () => {}, setStatus: (s: string) => statuses.push(s), setWorkspaceTask: () => {}, updateProject: f.update,
      openOwnedFolder, publishNewShot: (u: (p: Project) => Project, id: string, cur: () => boolean) => f.adapter.owner.publishNewShot(u, id, cur)
    } as any);
    await c.handleAddShot();
    expect(errors.length).toBeGreaterThan(0);      // the failed load was reported by the real adapter
    expect(blankCalls, "blank TIFF created after a failed owned open").toBe(0);
    expect(f.projectRef.current.shots).toHaveLength(1);
    expect(statuses.some(s => /^Added/.test(s))).toBe(false);
  } finally { await f.cleanup(); }
});
