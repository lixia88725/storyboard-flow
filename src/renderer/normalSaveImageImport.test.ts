import { expect, it, vi } from "vitest";
import ts from "typescript";
import { readFile } from "node:fs/promises";
import { createProject, ensureBitmapLayerMetadata } from "../shared/projectOps";
import type { Project, FolderScanPayload, ImportSwbFormatPayload, WorkspacePayload } from "../shared/types";
import { createNormalSaveAppAdapter } from "./normalSaveAppAdapter";
import { createBitmapLayerWriteQueue } from "./bitmapLayerWriteQueue";
import { registerWorkspaceAutosave } from "./workspaceAutosaveController";
const h = "1".repeat(64);
const gate = () => { let release!: () => void; const promise = new Promise<void>(r => release = r); return { promise, release }; };
async function actualApp(bindings: Record<string, unknown>) {
  const text = await readFile(new URL("./App.tsx", import.meta.url), "utf8");
  const tree = ts.createSourceFile("App.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression = "";
  const visit = (n: ts.Node) => { if (ts.isVariableDeclaration(n) && n.name.getText(tree) === "handleImportSwbFormat") expression = n.initializer!.getText(tree); ts.forEachChild(n, visit); }; visit(tree);
  return new Function(...Object.keys(bindings), ts.transpile(`const callback = ${expression}; return callback;`))(...Object.values(bindings));
}
function fixture() {
  const project: Project = { ...createProject("P"), shots: [{ id: "s", order: 0, imagePath: "/w/a.png", fileName: "a.png", swb: { version: 1, status: "non-swb", canvasWidth: 2, canvasHeight: 2 } }], pendingBake: { version: 1, shots: {} } };
  project.shots = project.shots.map(s => ensureBitmapLayerMetadata(s));
  const ref = { current: project }, queue = createBitmapLayerWriteQueue();
  const imported: Project = { ...project, shots: [{ ...project.shots[0], imagePath: "/w/a.tiff", fileName: "a.tiff", swb: { ...project.shots[0].swb!, status: "owned", sourcePath: "/w/a.png", archivePath: "/w/Archive/a.png" } }] };
  const result: FolderScanPayload = { folderPath: "/w", folderName: "w", metadataPath: "/w/p.json", images: [], project: imported,
    normalSaveImportEffects: [{ sourceShotId: "s", shotId: "s", sourcePath: "/w/a.png", sourceHash: h, targetPath: "/w/a.tiff", outputHash: h, kind: "converted" }] } as FolderScanPayload;
  const io = vi.fn(async (_payload: ImportSwbFormatPayload) => result), persist = vi.fn(async (_payload: WorkspacePayload) => undefined), published = vi.fn(), error = vi.fn();
  const api = { importSwbFormat: io, autosaveWorkspace: persist, readOutputIdentity: vi.fn(async () => h), saveWorkspace: vi.fn() };
  const adapter = createNormalSaveAppAdapter({ projectRef: ref, setProject: () => {}, queue, api: () => api, paths: () => ({ folderPath: "/w", metadataPath: "/w/p.json" }), freshToken: () => "fresh", onSave: () => {}, onError: error });
  const run = async () => {
    const callback = await actualApp({ window: { storyboard: api }, normalSaveAppEnabled: true, normalSaveAppAdapterRef: { current: adapter },
      project, folderPath: "/w", metadataPath: "/w/p.json", needsSwbImport: true, needsImageImport: true, blankShotPreset: "16:9", dirtyShotIds: () => [],
      sceneMatteModeForProject: () => undefined, sceneDialogueOverlayEnabledForProject: () => false,
      withStatus: async (_label: string, task: () => Promise<unknown>) => task(), loadFolderScan: async (scan: FolderScanPayload) => scan.project,
      setStatus: vi.fn(), setWorkspaceTask: vi.fn(), setIsImportHelpOpen: vi.fn(), normalSaveImageImportPublished: published, prepareNormalSaveImportMatte: async (p: Project) => p });
    return callback();
  };
  return { ref, queue, adapter, io, persist, published, error, result, run, api };
}
it("actual App manual image Import uses owned operation and publishes completed-shot pending H0", async () => {
  const f = fixture(); expect(await f.run()).toBe(true);
  expect(f.io).toHaveBeenCalledWith(expect.objectContaining({ normalSave: true, normalSaveImageImport: true }));
  expect(f.ref.current.shots[0].imagePath).toBe("/w/a.tiff");
  expect(f.ref.current.pendingBake!.shots.s).toMatchObject({ state: "pending", editToken: "fresh", acceptedOutputIdentity: h });
  expect(f.persist.mock.calls[0][0]).toMatchObject({ project: f.ref.current });
  expect(f.published).toHaveBeenCalledTimes(1);
});

const options = (published = () => {}) => ({ blankShotPreset: "16:9" as const, dirtyShotIds: [], prepare: async (p: Project) => p, published });
it("queued stale manual Import rejects before API I/O", async () => {
  const f = fixture(), g = gate(); const lock = f.queue.runExclusive(() => g.promise);
  const task = f.adapter.imageImport(options());
  f.adapter.owner.publishEdit(p => ({ ...p, name: "P2" }), []);
  g.release(); await lock; expect(await task).toBe(false); expect(f.io).not.toHaveBeenCalled(); expect(f.persist).not.toHaveBeenCalled();
});
it("P2 metadata during Import survives latest required persistence", async () => {
  const f = fixture(), g = gate(), entered = gate(); f.io.mockImplementation(async () => { entered.release(); await g.promise; return f.result; });
  const task = f.adapter.imageImport(options(f.published)); await entered.promise;
  f.adapter.owner.publishEdit(p => ({ ...p, name: "P2", dialogues: [{ id: "d", shotId: "s", text: "latest", order: 0 }] }), []);
  g.release(); expect(await task).toBe(true); expect(f.ref.current.name).toBe("P2"); expect(f.ref.current.dialogues[0].text).toBe("latest");
  expect(f.persist.mock.calls.at(-1)![0].project).toEqual(f.ref.current);
});
it.each([{ version: 2, shots: {} }, { version: 1, shots: { s: { state: "unknown" } } }, { version: 1, shots: { s: { state: "synced", acceptedOutputIdentity: "bad" } } }])("raw unknown/future/corrupt Import writes nothing", async raw => {
  const f = fixture(); f.ref.current.pendingBake = raw as Project["pendingBake"]; const before = JSON.stringify(f.ref.current);
  expect(await f.adapter.imageImport(options())).toBe(false); expect(f.io).not.toHaveBeenCalled(); expect(f.persist).not.toHaveBeenCalled(); expect(JSON.stringify(f.ref.current)).toBe(before);
});
it("bad actual output hash denies persistence and UI publication", async () => {
  const f = fixture(); f.api.readOutputIdentity.mockResolvedValue("2".repeat(64));
  expect(await f.adapter.imageImport(options(f.published))).toBe(false); expect(f.persist).not.toHaveBeenCalled(); expect(f.published).not.toHaveBeenCalled();
});
it("required MD failure after JSON is false, unpublished and Save/Close is not allowed", async () => {
  const f = fixture(); f.persist.mockRejectedValue(new Error("required MD after JSON"));
  expect(await f.adapter.imageImport(options(f.published))).toBe(false); expect(f.published).not.toHaveBeenCalled(); expect(await f.adapter.save()).toBe(false);
  const text = await readFile(new URL("./App.tsx", import.meta.url), "utf8"), tree = ts.createSourceFile("App.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression = "";
  const visit = (n: ts.Node) => { if (ts.isCallExpression(n) && n.expression.getText(tree) === "window.storyboard.onSaveAndCloseRequested") expression = n.arguments[0].getText(tree); ts.forEachChild(n, visit); }; visit(tree);
  let finish!: () => void; const settled = new Promise<void>(r => finish = r);
  const close = vi.fn(async (_payload: { requestId: string; saved: boolean }) => { finish(); });
  const bindings = { handleSaveProject: () => f.adapter.save(), window: { storyboard: { finishSaveAndClose: close } }, setStatus: vi.fn() };
  new Function(...Object.keys(bindings), ts.transpile(`return (${expression});`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(bindings))({ requestId: "isolated-close" });
  await settled; expect(close).toHaveBeenCalledWith({ requestId: "isolated-close", saved: false });
});
it("Import queue remains held through persistence and synchronous publication", async () => {
  const f = fixture(), g = gate(), entered = gate(); const order: string[] = [];
  f.persist.mockImplementation(async () => { order.push("persist"); entered.release(); await g.promise; });
  const task = f.adapter.imageImport(options(() => order.push("publish"))); await entered.promise;
  const next = f.queue.runExclusive(async () => { order.push("release"); }); expect(order).toEqual(["persist"]);
  g.release(); expect(await task).toBe(true); await next; expect(order).toEqual(["persist", "publish", "release"]);
});
it("ABA load retires Import error without new workspace UI", async () => {
  const f = fixture(), g = gate(), entered = gate(); f.io.mockImplementation(async () => { entered.release(); await g.promise; throw new Error("old operation"); });
  const task = f.adapter.imageImport(options(f.published)); await entered.promise;
  const load = f.adapter.owner.load({ ...f.ref.current, name: "new A" });
  g.release(); expect(await task).toBe(false); await load; expect(f.error).not.toHaveBeenCalled(); expect(f.published).not.toHaveBeenCalled(); expect(f.ref.current.name).toBe("new A");
});
it("explicit preserve retains pending internal layers but accepts only actual source baseline", async () => {
  const f = fixture(); f.ref.current.shots[0].swb!.status = "compatible-external-edit";
  f.ref.current.pendingBake!.shots.s = { state: "pending", editToken: "old", acceptedOutputIdentity: "3".repeat(64) };
  f.result.normalSaveImportEffects![0].kind = "preserved"; f.result.normalSaveImportEffects![0].targetPath = "/w/a.png";
  f.result.project!.shots[0].imagePath = "/w/a.png";
  expect(await f.adapter.imageImport(options())).toBe(true); expect(f.ref.current.shots[0].swb!.status).toBe("owned");
  expect(f.ref.current.pendingBake!.shots.s).toMatchObject({ state: "pending", editToken: "old", acceptedOutputIdentity: h });
});

it("explicit duplicate keeps original pending and gives actual duplicate fresh H0 without certifying whole returned Project", async () => {
  const f = fixture(); f.ref.current.shots[0].swb!.status = "compatible-external-edit";
  f.ref.current.pendingBake!.shots.s = { state: "pending", editToken: "old", acceptedOutputIdentity: "3".repeat(64) };
  f.result.project!.shots = [{ ...f.ref.current.shots[0], swb: { ...f.ref.current.shots[0].swb!, status: "owned" } }, { ...f.result.project!.shots[0], id: "duplicate" }];
  f.result.normalSaveImportEffects![0].shotId = "duplicate"; f.result.normalSaveImportEffects![0].kind = "accepted";
  expect(await f.adapter.imageImport(options())).toBe(true);
  expect(f.io.mock.calls[0][0].dirtyShotIds).toContain("s");
  expect(f.ref.current.pendingBake!.shots.s).toMatchObject({ state: "pending", editToken: "old", acceptedOutputIdentity: h });
  expect(f.ref.current.pendingBake!.shots.duplicate).toMatchObject({ state: "pending", editToken: "fresh", acceptedOutputIdentity: h });
});
it("P2 arriving during required persistence is merged and durably persisted before publication", async () => {
  const f = fixture(), g = gate(), entered = gate(); let first = true;
  f.persist.mockImplementation(async () => { if (first) { first = false; entered.release(); await g.promise; } });
  const task = f.adapter.imageImport(options(f.published)); await entered.promise;
  f.adapter.owner.publishEdit(p => ({ ...p, name: "P2-during-MD" }), []); g.release();
  expect(await task).toBe(true); expect(f.persist).toHaveBeenCalledTimes(2);
  expect(f.persist.mock.calls.at(-1)![0].project.name).toBe("P2-during-MD"); expect(f.ref.current.name).toBe("P2-during-MD");
});

it("actual App Import publication uses finite history invalidation, never load/reset", async () => {
  const f = fixture(), text = await readFile(new URL("./App.tsx", import.meta.url), "utf8");
  const tree = ts.createSourceFile("App.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); let expression = "";
  const visit = (n: ts.Node) => { if (ts.isVariableDeclaration(n) && n.name.getText(tree) === "normalSaveImageImportPublished") expression = n.initializer!.getText(tree); ts.forEachChild(n, visit); }; visit(tree);
  const invalidate = vi.fn(), onPublication = vi.fn(); f.ref.current = f.result.project!;
  const bindings = { project: fixture().ref.current, projectRef: f.ref, invalidatePresentationHistory: invalidate,
    normalSaveAppCallbacksRef: { current: { onPendingPublication: onPublication } }, setStatus: vi.fn() };
  new Function(...Object.keys(bindings), ts.transpile(`return (${expression});`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(bindings))(f.result);
  expect(invalidate).toHaveBeenCalledWith(f.ref.current, ["s"], [".storyboard-workbench/layers/s/layer-image.png"]); expect(onPublication).toHaveBeenCalledWith({ durable: true });
});

it("actual owner load preserves pristine missing-entry external admission for explicit user Import", async () => {
  const f = fixture(); expect(await f.adapter.owner.load(f.ref.current)).toBe(true);
  expect(await f.adapter.imageImport(options())).toBe(true);
});

it("Import preparation uses latest dialogue input and rejects dependency changes during await", async () => {
  const f = fixture(), g = gate(), entered = gate();
  const prepare = vi.fn(async (p: Project) => { entered.release(); await g.promise; return p; });
  const task = f.adapter.imageImport({ ...options(), prepare }); await entered.promise;
  f.adapter.owner.publishEdit(p => ({ ...p, dialogues: [{ id: "d", shotId: "s", text: "P2", order: 0 }] }), []);
  g.release(); expect(await task).toBe(false); expect(f.persist).not.toHaveBeenCalled();
  expect(f.ref.current.dialogues[0].text).toBe("P2");
});

it("actual main ACK followed by matte failure gates subsequent Save and autosave", async () => {
  const f = fixture();
  f.ref.current.shots[0].swb!.status = "compatible-external-edit";
  f.ref.current.pendingBake!.shots.s = { state: "synced", acceptedOutputIdentity: h };
  expect(await f.adapter.imageImport({ ...options(), prepare: async () => { throw new Error("matte first write failed"); } })).toBe(false);
  expect(f.ref.current.pendingBake!.shots.s.state).toBe("unknown");
  expect(f.ref.current.shots[0].imagePath).toBe("/w/a.tiff");
  expect(await f.adapter.save()).toBe(false);
  expect(await f.adapter.autosave(f.ref.current)).toBe(false);
  expect(f.api.saveWorkspace).not.toHaveBeenCalled(); expect(f.persist).not.toHaveBeenCalled();
});

it("continuous edits during Import persistence return finitely and release queue without repeating Import", async () => {
  const f = fixture(); let n = 0;
  f.persist.mockImplementation(async () => {
    n++; if (n > 2) throw new Error("test finite boundary: third persist prohibited");
    f.adapter.owner.publishEdit(p => ({ ...p, name: `P${n + 1}` }), []);
  });
  expect(await f.adapter.imageImport(options(f.published))).toBe(false);
  expect(f.persist).toHaveBeenCalledTimes(2); expect(f.io).toHaveBeenCalledTimes(1);
  expect(f.ref.current.name).toBe("P3"); expect(f.ref.current.shots[0].imagePath).toBe("/w/a.tiff");
  expect(f.ref.current.pendingBake!.shots.s.state).toBe("pending");
  const release = vi.fn(); await f.queue.runExclusive(async () => { release(); }); expect(release).toHaveBeenCalledOnce();
});

it("actual Import publication reschedules ordinary autosave after a queued old timer rejects", async () => {
  const f = fixture(); const callbacks: (() => void)[] = []; let n = 0;
  const timers = { setTimeout: (fn: () => void) => { callbacks.push(fn); return callbacks.length; }, clearTimeout: () => {} };
  const schedule = () => registerWorkspaceAutosave({ autosaveRevision: 1,
    folderPathRef: { current: "/w" }, metadataPathRef: { current: "/w/p.json" }, hasStoryboardApi: true,
    projectRef: f.ref, timers, setStatus: vi.fn(), setWorkspaceSaveState: vi.fn(), setAutosaveError: vi.fn(),
    persistWorkspace: p => f.adapter.autosave(p).then(() => undefined) });
  f.persist.mockImplementation(async () => {
    n++;
    if (n <= 2) {
      f.adapter.owner.publishEdit(p => ({ ...p, name: `P${n + 1}` }), []);
      if (n === 2) { schedule(); callbacks[0](); }
    }
  });
  const text = await readFile(new URL("./App.tsx", import.meta.url), "utf8"), tree = ts.createSourceFile("App.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let publication = "", pending = "";
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === "normalSaveImageImportPublished") publication = node.initializer!.getText(tree);
    if (ts.isPropertyAssignment(node) && node.name.getText(tree) === "onPendingPublication" && node.initializer.getText(tree).includes("setAutosaveRevision")) pending = node.initializer.getText(tree);
    ts.forEachChild(node, visit);
  }; visit(tree);
  const controls = { rebasePendingHistory: vi.fn(), setFileNameSyncState: vi.fn(), fileNameSyncStateRef: { current: "synced" },
    setWorkspaceSaveState: vi.fn(), workspaceSaveStateRef: { current: "saved" }, setAutosaveRevision: schedule };
  const onPendingPublication = new Function(...Object.keys(controls), ts.transpile(`return (${pending});`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(controls));
  const bindings = { project: f.ref.current, projectRef: f.ref, invalidatePresentationHistory: vi.fn(),
    normalSaveAppCallbacksRef: { current: { onPendingPublication } }, setStatus: vi.fn() };
  const published = new Function(...Object.keys(bindings), ts.transpile(`return (${publication});`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(bindings));
  expect(await f.adapter.imageImport({ ...options(), published })).toBe(false);
  await f.queue.runExclusive(async () => {});
  expect(n).toBe(2); expect(callbacks).toHaveLength(2);
  callbacks[1](); await f.queue.runExclusive(async () => {});
  expect(n).toBe(3); expect(f.io).toHaveBeenCalledTimes(1);
  expect(f.persist.mock.calls.at(-1)![0].project).toBe(f.ref.current);
  expect(f.ref.current.name).toBe("P3"); expect(f.ref.current.shots[0].imagePath).toBe("/w/a.tiff");
});

it("post-ACK preparation error in a retired epoch cannot mark or report into the new workspace", async () => {
  const f = fixture(), entered = gate(), g = gate();
  const task = f.adapter.imageImport({ ...options(f.published), prepare: async () => { entered.release(); await g.promise; throw new Error("old matte recovery failure"); } });
  await entered.promise;
  const load = f.adapter.owner.load({ ...createProject("new workspace"), pendingBake: { version: 1, shots: {} } });
  g.release(); expect(await task).toBe(false); await load;
  expect(f.error).not.toHaveBeenCalled(); expect(f.published).not.toHaveBeenCalled();
  expect(f.ref.current.name).toBe("new workspace"); expect(f.ref.current.pendingBake!.shots).toEqual({});
});

it("actual App Import recovery subscriber preserves the existing detailed rollback message and gates UI state", async () => {
  const text = await readFile(new URL("./App.tsx", import.meta.url), "utf8"), tree = ts.createSourceFile("App.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); let expression = "";
  const visit = (n: ts.Node) => { if (ts.isPropertyAssignment(n) && n.name.getText(tree) === "onImportRecoveryRequired") expression = n.initializer.getText(tree); ts.forEachChild(n, visit); }; visit(tree);
  const bindings = { workspaceRecoveryRequiredRef: { current: "asset rollback failed: origin path retained" }, workspaceSaveStateRef: { current: "saved" },
    setWorkspaceSaveState: vi.fn(), setAutosaveError: vi.fn(), autosaveErrorReducer: vi.fn(), setSaveErrorDialog: vi.fn() };
  const callback = new Function(...Object.keys(bindings), ts.transpile(`return (${expression});`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(bindings));
  callback("generic Import incomplete");
  expect(bindings.workspaceRecoveryRequiredRef.current).toBe("asset rollback failed: origin path retained");
  expect(bindings.workspaceSaveStateRef.current).toBe("error"); expect(bindings.setWorkspaceSaveState).toHaveBeenCalledWith("error");
  expect(bindings.setSaveErrorDialog).toHaveBeenCalledWith("asset rollback failed: origin path retained");
});
