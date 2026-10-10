import { expect, it, vi } from "vitest";
import { createNormalSaveAppAdapter } from "./normalSaveAppAdapter";
import { createBitmapLayerWriteQueue } from "./bitmapLayerWriteQueue";
import { createProject, mergeFolderImages } from "../shared/projectOps";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { useClipboardActionController } from "./clipboardActionController";
import { createShotPresentationController } from "./shotPresentationController";
const H = "a".repeat(64);
function fixture() {
 const project = mergeFolderImages(createProject("real metadata"), [{ imagePath: "/A/a.tiff", fileName: "a.tiff", width: 4, height: 3 }]);
 const shot = project.shots[0]; shot.swb!.status = "owned";
 project.pendingBake = { version: 1, shots: { [shot.id]: { state: "synced", acceptedOutputIdentity: H } } };
 const ref = { current: project }, queue = createBitmapLayerWriteQueue(), effects = vi.fn(async (p: any) => p), persist = vi.fn(), errors: unknown[] = [];
 const adapter = createNormalSaveAppAdapter({ projectRef: ref, setProject: () => {}, queue, paths: () => ({ folderPath: "/A", metadataPath: "/A/p.json" }), api: () => ({ ensureLayerAssets: effects, exportPhotoshopTiffs: effects, saveWorkspace: effects, autosaveWorkspace: persist, readOutputIdentity: async () => H }) as any, freshToken: () => "t2", onSave: () => {}, onError: e => errors.push(e) });
 return { ref, queue, adapter, effects, persist, errors };
}
it.each(["clean", "queued-P2"])("actual App presentation ensure caller uses the normal gate before internal asset IO: %s", async mode => {
 const f = fixture(); await f.adapter.owner.load(f.ref.current);
 const app = await readFile(new URL("./App.tsx", import.meta.url), "utf8"), ast = ts.createSourceFile("App.tsx", app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
 let expression = "";
 const walk = (n: ts.Node) => { if (ts.isCallExpression(n) && n.expression.getText(ast) === "createShotPresentationController") expression = n.arguments[0].getText(ast); ts.forEachChild(n, walk); }; walk(ast);
 const api = { ensureLayerAssets: f.effects };
 const bindings: Record<string, any> = { window: { storyboard: api }, normalSaveAppEnabled: true, normalSaveAppAdapterRef: { current: f.adapter }, invalidatePresentationHistory: () => {}, bitmapLayerWriteQueueRef: { current: f.queue }, createHistoryEntry: async () => ({ project: f.ref.current }), folderPath: "/A", metadataPath: "/A/p.json", workspaceRecoveryRequiredRef: { current: undefined }, markShotsDirty: () => {}, projectRef: f.ref, recordUndoEntry: () => {}, setStatus: () => {}, shotPresentationActionRef: { current: undefined }, updateProject: () => {} };
 // When present, execute the actual App wrapper declaration as well as caller options.
 let wrapper = ""; const decl = (n: ts.Node) => { if (ts.isVariableDeclaration(n) && n.name.getText(ast) === "normalSaveAssetApi") wrapper = n.initializer!.getText(ast); ts.forEachChild(n, decl); }; decl(ast);
 if (wrapper) bindings.normalSaveAssetApi = new Function(...Object.keys(bindings), ts.transpile(`return (${wrapper});`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(bindings));
 const options = new Function(...Object.keys(bindings), ts.transpile(`return (${expression});`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(bindings));
 let release!: () => void, enter!: () => void;
 const entered = new Promise<void>(r => { enter = r; });
 const held = mode === "queued-P2" ? f.queue.runExclusive(() => new Promise<void>(r => { release = r; enter(); })) : undefined;
 if (held) await entered;
 const operation = createShotPresentationController(options).handleSetShotMatteMode("expanded");
 if (held) { f.adapter.owner.publishEdit(p => ({ ...p, name: "queued metadata P2" }), []); release(); await held; }
 await operation;
 if (held) expect(f.effects).not.toHaveBeenCalled(); else expect(f.effects.mock.calls[0]?.[0].normalSave).toBe(true);
 expect(f.persist).not.toHaveBeenCalled();
});
it("actual App Clipboard captureScope and existing Paste queue reject metadata-P2 before ensure or copy", async () => {
 const f = fixture(); await f.adapter.owner.load(f.ref.current);
 const app = await readFile(new URL("./App.tsx", import.meta.url), "utf8"), ast = ts.createSourceFile("App.tsx", app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); let expression = "";
 const walk = (n: ts.Node) => { if (ts.isCallExpression(n) && n.expression.getText(ast) === "useClipboardActionController") { const option = n.arguments[0] as ts.ObjectLiteralExpression; expression = (option.properties.find(p => p.name?.getText(ast) === "captureEnsureScope") as ts.PropertyAssignment).initializer.getText(ast); } ts.forEachChild(n, walk); }; walk(ast);
 const captureEnsureScope = new Function("normalSaveAppEnabled", "normalSaveAppAdapterRef", ts.transpile(`return (${expression});`, { target: ts.ScriptTarget.ES2022 }))(true, { current: f.adapter });
 const id = f.ref.current.shots[0].id, copied = vi.fn();
 const controller = useClipboardActionController({ captureEnsureScope, api: { ensureLayerAssets: f.effects, copyShotAssets: copied, copyLayerPng: copied }, captureWorkspace: () => ({ identity: {}, folderPath: "/A", metadataPath: "/A/p.json" }), isCurrentWorkspace: () => true, isImageImportLocked: () => false, bitmapLayerWriteQueueRef: { current: f.queue }, clipboardSelectionRef: { current: { type: "shot", shotId: id } }, projectRef: f.ref, selectedShotIdsRef: { current: [id] }, createId: () => "copied", createHistoryEntry: async () => ({}), deleteTargetRef: { current: { type: "shot" } }, folderPath: "/A", metadataPath: "/A/p.json", markShotsDirty: () => {}, queuePasteAnimation: () => {}, recordUndoEntry: () => {}, selectSingleShot: () => {}, setClipboardSelection: () => {}, setDeleteTarget: () => {}, setSelectedBitmapLayerIds: () => {}, setStatus: () => {}, updateProject: () => {} });
 let release!: () => void, enter!: () => void; const entered = new Promise<void>(r => { enter = r; }); const held = f.queue.runExclusive(() => new Promise<void>(r => { release = r; enter(); })); await entered;
 const operation = controller.handlePasteSelection(); f.adapter.owner.publishEdit(p => ({ ...p, name: "P2" }), []); release(); await held; await operation;
 expect(f.effects).not.toHaveBeenCalled(); expect(copied).not.toHaveBeenCalled(); expect(f.persist).not.toHaveBeenCalled();
});
it.each(["ensure", "export"])("actual adapter %s capture waits for queue and rejects metadata-P2 before first effect", async kind => {
 const f = fixture(); await f.adapter.owner.load(f.ref.current);
 let release!: () => void, enter!: () => void; const entered = new Promise<void>(r => { enter = r; }); const held = f.queue.runExclusive(() => new Promise<void>(r => { release = r; enter(); })); await entered;
 const request = kind === "ensure" ? (f.adapter as any).ensureLayerAssets() : (f.adapter as any).exportPhotoshopTiffs();
 f.adapter.owner.publishEdit(p => ({ ...p, name: "P2" }), []); release(); await held;
 expect(await request).toBe(false); expect(f.effects).not.toHaveBeenCalled(); expect(f.persist).not.toHaveBeenCalled(); expect(f.ref.current.name).toBe("P2");
});
it.each(["ensure", "export"])("actual adapter %s effects do not publish old result or persist metadata during P2", async kind => {
 const f = fixture(); await f.adapter.owner.load(f.ref.current);
 let release!: () => void, entered!: () => void; const started = new Promise<void>(r => { entered = r; });
 f.effects.mockImplementation(async p => { entered(); await new Promise<void>(r => { release = r; }); return { ...p, project: { ...p.project, name: "old result" } }; });
 const request = kind === "ensure" ? (f.adapter as any).ensureLayerAssets() : (f.adapter as any).exportPhotoshopTiffs(); await started;
 f.adapter.owner.publishEdit(p => ({ ...p, name: "P2" }), []); release();
 expect(await request).toBe(false); expect(f.ref.current.name).toBe("P2"); expect(f.persist).not.toHaveBeenCalled();
 expect(f.effects.mock.calls[0][0].normalSave).toBe(true);
});
it.each(["ensure", "export"])("actual adapter %s rejects ABA and readonly load requests before queue effect", async kind => {
 const f = fixture(); await f.adapter.owner.load(f.ref.current);
 let release!: () => void, enter!: () => void; const entered = new Promise<void>(r => { enter = r; }); const held = f.queue.runExclusive(() => new Promise<void>(r => { release = r; enter(); })); await entered;
 const request = kind === "ensure" ? f.adapter.ensureLayerAssets() : f.adapter.exportPhotoshopTiffs();
 const a = f.ref.current; const b = f.adapter.owner.load({ ...createProject("B"), pendingBake: { version: 1, shots: {} } }); const again = f.adapter.owner.load(a);
 release(); await held; expect(await request).toBe(false); await b; await again;
 expect(f.effects).not.toHaveBeenCalled(); expect(f.persist).not.toHaveBeenCalled();
});
it.each(["ensure", "export"])("actual adapter %s error after epoch change never reports in new workspace", async kind => {
 const f = fixture(); await f.adapter.owner.load(f.ref.current);
 let release!: () => void, enter!: () => void; const entered = new Promise<void>(r => { enter = r; });
 f.effects.mockImplementation(async () => { enter(); await new Promise<void>(r => { release = r; }); throw new Error("old effect error"); });
 const request = kind === "ensure" ? f.adapter.ensureLayerAssets() : f.adapter.exportPhotoshopTiffs(); await entered;
 const load = f.adapter.owner.load({ ...createProject("B"), pendingBake: { version: 1, shots: {} } }); release(); expect(await request).toBe(false); await load;
 expect(f.errors).toEqual([]); expect(f.ref.current.name).toBe("B"); expect(f.persist).not.toHaveBeenCalled();
});
it.each(["ensure", "export"])("actual adapter %s rejects unknown and read-only new load before asset effects", async kind => {
 const f = fixture(), p = f.ref.current;
 p.pendingBake!.shots[p.shots[0].id] = { state: "unknown" }; await f.adapter.owner.load(p);
 expect(await (kind === "ensure" ? (f.adapter as any).ensureLayerAssets() : (f.adapter as any).exportPhotoshopTiffs())).toBe(false);
 expect(f.effects).not.toHaveBeenCalled(); expect(f.persist).not.toHaveBeenCalled();
});
