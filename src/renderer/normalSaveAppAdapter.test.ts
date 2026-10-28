import { readFile } from "node:fs/promises";
import ts from "typescript";
import { expect, it } from "vitest";
import { createProject } from "../shared/projectOps";
import { pendingBakeForProject } from "../shared/pendingBake";
import { createBitmapLayerWriteQueue } from "./bitmapLayerWriteQueue";
import { formatSaveFailureStatus } from "./saveErrors";
import { createWorkspaceSlots } from './workspaceSlots';
import { formatWorkspaceOpenError } from './workspaceOpenErrors';
const mod = await import("./normalSaveAppAdapter").catch(() => undefined);
const h0 = "0".repeat(64), h1 = "1".repeat(64);
const p = () => ({ ...createProject("P"), naming: { sceneCode: "S", artistName: "A", version: "V" }, shots: [{ id: "s", imagePath: "/w/a.tiff", fileName: "a.tiff", order: 0, swb: { version: 1, status: "owned" as const, canvasWidth: 8, canvasHeight: 6 } }], pendingBake: { version: 1 as const, shots: { s: { state: "pending" as const, editToken: "t1", acceptedOutputIdentity: h0 } } } });
const deferred = () => { let release!: () => void; const promise = new Promise<void>(r => release = r); return { promise, release }; };
function setup(onError?: (error: unknown) => void) {
  const projectRef = { current: p() }; let identity = h0; const events: string[] = []; let fault = false;
  const queue = createBitmapLayerWriteQueue();
  const api = { readOutputIdentity: async () => identity, autosaveWorkspace: async (payload: any) => { events.push(`persist:${payload.project.name}`); if (fault) throw new Error("MD fault"); return payload; },
    saveWorkspace: async (payload: any) => { identity = h1; return { ...payload, normalSaveOutputs: payload.project.shots.map((s: any) => ({ shotId: s.id, capturedToken: "t1", sourcePath: "/w/a.tiff", targetPath: s.imagePath, fileName: s.fileName, outputHash: h1, baseFingerprint: "fp" })) }; } };
  expect(mod, "actual App adapter missing").toBeDefined();
  const adapter = mod!.createNormalSaveAppAdapter({ projectRef, setProject: (next: any) => { expect(projectRef.current).toBe(next); }, queue,
    api: () => api, paths: () => ({ folderPath: "/w", metadataPath: "/w/project.json" }), freshToken: () => "t2",
    onSave: (saved: boolean) => events.push(`saved:${saved}`), onError: (error: unknown) => { events.push(`error:${String(error)}`); onError?.(error); } });
  return { adapter, projectRef, api, events, queue, set fault(v: boolean) { fault = v; } };
}
async function actualSave(f: ReturnType<typeof setup>, setWorkspaceTask: (value: any) => void = () => {}) {
  const source = await readFile(new URL("./App.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let decl: ts.VariableDeclaration | undefined;
  const walk = (n: ts.Node) => { if (ts.isVariableDeclaration(n) && n.name.getText(ast) === "handleSaveProject") decl = n; ts.forEachChild(n, walk); }; walk(ast);
  const bindings = { renderAdapter: f.adapter, saveInFlightRef: { current: undefined }, window: { storyboard: f.api }, folderPath: "/w", metadataPath: "/w/project.json", workspaceRecoveryRequiredRef: { current: undefined }, needsSwbImport: false, project: f.projectRef.current, projectRef: f.projectRef, normalSaveAppAdapterRef: { current: f.adapter }, normalSaveAppEnabled: true,
    setWorkspaceTask, setStatus: () => {}, setSaveErrorDialog: () => {}, nudgeImportRequired: () => {}, defaultSaveNaming: {}, runExclusiveWorkspaceAction: async (_ref: unknown, fn: () => Promise<boolean>) => fn() };
  const compiled = ts.transpile(`const ${decl!.getText(ast)};`);
  return new Function(...Object.keys(bindings), `${compiled}; return handleSaveProject();`)(...Object.values(bindings));
}
it("actual App Save enables progress while awaiting the owner and clears only its own task", async () => {
  const f = setup(), gate = deferred(), started = deferred(), output = f.api.saveWorkspace;
  let task: any;
  const setter = (value: any) => { task = typeof value === "function" ? value(task) : value; };
  f.api.saveWorkspace = async payload => { started.release(); await gate.promise; return output(payload); };
  const saving = actualSave(f, setter); await started.promise;
  expect(task?.kind).toBe("save");
  gate.release(); expect(await saving).toBe(true); expect(task).toBeUndefined();
});
it("Save rejection retains the actionable conflict status instead of a generic incomplete notice", async () => {
  const source = await readFile(new URL("./App.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let decl: ts.VariableDeclaration | undefined;
  const walk = (n: ts.Node) => { if (ts.isVariableDeclaration(n) && n.name.getText(ast) === "normalSaveAppCallbacks") decl = n; ts.forEachChild(n, walk); }; walk(ast);
  const ui: string[] = [];
  const bindings = { workspaceSaveStateRef: { current: "saved" }, setWorkspaceSaveState: () => {}, setAutosaveError: () => {}, setSaveErrorDialog: () => {}, setStatus: (s: string) => ui.push(s), setWorkspaceTask: () => {}, formatSaveFailureStatus };
  const callbacks = new Function(...Object.keys(bindings), ts.transpile(`const ${decl!.getText(ast)}; return normalSaveAppCallbacks;`))(...Object.values(bindings));
  const f = setup(callbacks.onError);
  f.api.saveWorkspace = async () => { throw new Error("Temporary rename file already exists: /w/.storyboard-renaming-s.tiff"); };
  expect(await actualSave(f)).toBe(false);
  expect(f.events.some(event => event.startsWith("saved:"))).toBe(false);
  expect(ui).toEqual([formatSaveFailureStatus("Temporary rename file already exists: /w/.storyboard-renaming-s.tiff")]);
  expect(f.projectRef.current.pendingBake.shots.s.state).toBe("pending");
});
it("actual App Save function returns true only after owner final persist, without resetting history", async () => {
  const f = setup(); expect(await actualSave(f)).toBe(true);
  expect(f.events).toEqual(["persist:P", "saved:true"]);
  expect(f.projectRef.current.pendingBake.shots.s.state).toBe("synced");
});
it("typed incomplete Save blocks subsequent autosave, Save and derived writers without laundering the old Project", async () => {
  const f = setup();
  f.api.saveWorkspace = async () => ({ ok: false, error: {
    code: "SAVE_RECOVERY_INCOMPLETE", message: "metadata publication incomplete", recoveryIncomplete: true,
    publicationOrCleanup: "started", metadata: "unknown", retainedPaths: ["/w/owned-backup"]
  } } as any);
  expect(await f.adapter.save()).toBe(false);
  const before = structuredClone(f.projectRef.current);
  expect(await f.adapter.autosave(f.projectRef.current)).toBe(false);
  expect(await f.adapter.save()).toBe(false);
  expect(f.adapter.owner.captureEffectAdmission()()).toBe(false);
  expect(f.projectRef.current).toEqual(before);
  expect(f.events.some(event => event.startsWith("persist:") || event.startsWith("saved:"))).toBe(false);
});
it("typed incomplete Save refuses actual manual and automatic image Import before any asset effect", async () => {
  const f = setup();
  f.api.saveWorkspace = async () => ({ ok: false, error: {
    code: "SAVE_RECOVERY_INCOMPLETE", message: "publication incomplete", recoveryIncomplete: true,
    publicationOrCleanup: "started", metadata: "unknown", retainedPaths: ["/w/owned-backup"]
  } } as any);
  let imports = 0, publications = 0;
  (f.api as any).importSwbFormat = async () => { imports++; throw new Error("Import must never start"); };
  expect(await f.adapter.save()).toBe(false);
  const before = structuredClone(f.projectRef.current);
  const options = { blankShotPreset: {} as any, dirtyShotIds: [],
    prepare: async (project: any) => project, published: () => { publications++; } };
  expect(await f.adapter.imageImport(options)).toBe(false);
  expect(await f.adapter.externalRefresh({ ...options, check: async project => ({ ...project,
    shots: project.shots.map(shot => ({ ...shot, swb: { ...shot.swb!, status: "compatible-external-edit" as const } })) }) })).toBe(false);
  expect(imports).toBe(0);
  expect(publications).toBe(0);
  expect(f.projectRef.current).toEqual(before);
  expect(await f.adapter.autosave(f.projectRef.current)).toBe(false);
});
it("actual App Save returns false / Close blocked for t2 published while output waits", async () => {
  const f = setup(), gate = deferred(); const base = f.api.saveWorkspace;
  f.api.saveWorkspace = async payload => { await gate.promise; return base(payload); };
  const saving = actualSave(f);
  await new Promise(r => setTimeout(r, 30));
  f.adapter.owner.publishEdit(current => ({ ...current, name: "P2" }), ["s"]); gate.release();
  expect(await saving).toBe(false);
  expect(f.projectRef.current.name).toBe("P2");
  expect(f.projectRef.current.pendingBake.shots.s.editToken).toBe("t2");
  expect(f.events).toEqual(["persist:P2", "saved:false"]);
});
it("disk reader runs after admitted work; old same-folder failure cannot touch new epoch UI", async () => {
  const f = setup(), gate = deferred(); const admitted = f.queue.runExclusive(() => gate.promise);
  let read = false;
  const loading = f.adapter.load(async () => { read = true; return { folderPath: "/w", metadataPath: "/w/project.json", folderName: "w", images: [], project: p() }; }, () => {});
  await Promise.resolve(); expect(read).toBe(false); gate.release(); await admitted; expect(await loading).toBe(true);
  const failure = deferred(); f.api.autosaveWorkspace = async () => { await failure.promise; throw new Error("old"); };
  const saving = f.adapter.autosave(f.projectRef.current);
  await new Promise(r => setTimeout(r, 5));
  const reloading = f.adapter.load(async () => ({ folderPath: "/w", metadataPath: "/w/project.json", folderName: "w", images: [], project: p() }), () => {});
  failure.release(); expect(await saving).toBe(false); expect(await reloading).toBe(true);
  expect(f.events.some(x => x.startsWith("error:"))).toBe(false);
});
async function actualCaller(name: string, bindings: Record<string, unknown>, args: unknown[] = []) {
  const source = await readFile(new URL("./App.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let decl: ts.VariableDeclaration | undefined;
  let publication: ts.VariableDeclaration | undefined;
  const walk = (n: ts.Node) => { if (ts.isVariableDeclaration(n)) { if (n.name.getText(ast) === name) decl = n; if (n.name.getText(ast) === "publishNormalSaveFolderScan") publication = n; } ts.forEachChild(n, walk); }; walk(ast);
  const helper = name === "handleOpenFolderByPath" || name === "loadFolderScan" ? `const ${publication!.getText(ast)};` : "";
  bindings = { folderOpenRequestRef: { current: 0 }, setFolderBrowser: () => {}, formatWorkspaceOpenError, renderAdapter: (bindings.normalSaveAppAdapterRef as {current:unknown})?.current, ...bindings };
  if (name === 'handleOpenFolderByPath') {
    const publish = new Function(...Object.keys(bindings), ts.transpile(`${helper} return publishNormalSaveFolderScan;`, {target:ts.ScriptTarget.ES2022}))(...Object.values(bindings));
    const queue = bindings.queue as ReturnType<typeof createBitmapLayerWriteQueue>;
    const api = (bindings.window as any).storyboard;
    bindings.workspaceSlotsRef = {current:createWorkspaceSlots({initialProject:createProject('Untitled'),
      adapterPorts:()=>({queue,api:()=>api,freshToken:()=> 't',onSave:()=>{},onError:()=>{}}),
      publishProject: p => { (bindings.projectRef as {current:unknown}).current=p; },
      observe: async()=>({binding:'test-observation',folderPath:'/w',metadataPath:'/w/project.json'}),captureView:()=>({}),certifyHandoff:async()=>false,
      drain:()=>queue.drain(),publishActive:(slot,scan)=>publish(scan,slot.projectRef.current,'Folder opened; output compatibility checked',true,true)})};
  }
  return new Function(...Object.keys(bindings), ts.transpile(`${helper}const ${decl!.getText(ast)}; return ${name};`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(bindings))(...args);
}
it("actual App open-folder caller defers disk reader until old queue settles, publishes newest ref before release", async () => {
  const f = setup(), gate = deferred();
  const old = f.queue.runExclusive(() => gate.promise);
  const events: string[] = [];
  const open = actualCaller("handleOpenFolderByPath", {
    normalSaveAppEnabled: true, normalSaveAppAdapterRef: { current: f.adapter }, queue: f.queue, projectRef: f.projectRef, folderInputValue: "/w",
    blankShotPreset: "16:9", prepareNormalSaveImportMatte: async (p: unknown) => p, normalSaveImageImportPublished: () => {},
    aiApplyWorkspaceIdentityRef: { current: {} }, scriptImportCheckIdRef: { current: 0 }, workspaceRecoveryRequiredRef: { current: undefined },
    pendingBakeForProject, workspaceSaveStateRef: { current: "saved" }, fileNameSyncStateRef: { current: "synced" }, setWorkspaceSaveState: () => {}, setFileNameSyncState: () => {},
    setScriptImportNeeded: () => {}, resetHistoryStacks: () => events.push("history-reset"), selectSingleShot: () => {}, resetTrackedDirtyShots: () => {},
    window: { storyboard: { ...f.api, openFolderByPath: async () => { events.push("disk-read"); return { folderPath: "/w", metadataPath: "/w/project.json", folderName: "w", images: [], project: { ...p(), name: "disk-new" } }; } } },
    setStatus: (s: string) => events.push(s), setWorkspaceTask: () => {}, folderPathRef: { current: "/old" }, metadataPathRef: { current: "/old/project.json" }, setFolderPath: () => {}, setFolderInputValue: () => {}, setMetadataPath: () => {}, setShotBitmapRevisionById: () => {}, bumpWorkspaceShotBitmapRevisions: () => {}
  });
  await new Promise(r => setTimeout(r, 10)); expect(events).toEqual([]);
  gate.release(); await old; await open;
  expect(events[0]).toBe("disk-read"); expect(f.projectRef.current.name).toBe("disk-new"); expect(events).toContain("history-reset");
});
it("actual App autosave caller with stale Project never persists newer ref under old payload", async () => {
  const f = setup(); const old = f.projectRef.current;
  f.adapter.owner.publishEdit(current => ({ ...current, name: "newer" }), ["s"]);
  await actualCaller("persistWorkspace", { normalSaveAppEnabled: true, normalSaveAppAdapterRef: { current: f.adapter }, folderPath: "/w", metadataPath: "/w/project.json" }, [old]);
  expect(f.events).toEqual([]); expect(f.projectRef.current.name).toBe("newer");
});
it("P3 published during final persist leaves current Save false while retiring durable receipt", async () => {
  const f = setup(); let once = true; const persist = f.api.autosaveWorkspace;
  f.api.autosaveWorkspace = async payload => {
    if (once) { once = false; f.adapter.owner.publishEdit(current => ({ ...current, name: "P3" }), ["s"]); }
    return persist(payload);
  };
  expect(await actualSave(f)).toBe(false);
  expect(f.projectRef.current.name).toBe("P3");
  expect(await f.adapter.autosave(f.projectRef.current)).toBe(true);
  expect(f.events).toEqual(["persist:P", "saved:false", "persist:P3"]);
});
it("required MD failure retains receipt; retry persists H1 without rebaking matching t1", async () => {
  const f = setup(); let outputs = 0; const output = f.api.saveWorkspace;
  f.api.saveWorkspace = async payload => { outputs++; return output(payload); };
  f.fault = true; expect(await actualSave(f)).toBe(false);
  expect(await f.adapter.autosave(f.projectRef.current)).toBe(false);
  f.fault = false; expect(await actualSave(f)).toBe(true); expect(outputs).toBe(1);
  expect(f.projectRef.current.pendingBake.shots.s.state).toBe("synced");
  expect(f.events.filter(event => event.startsWith("error:")).length).toBe(1);
});
it.each(["removed", "source-conflict", "new-shot"])("actual App Save rejects %s during output without applying old rename", async kind => {
  const f = setup(), gate = deferred(), started = deferred(); const output = f.api.saveWorkspace;
  f.api.saveWorkspace = async payload => { started.release(); await gate.promise; return output(payload); };
  const saving = actualSave(f); await started.promise;
  f.adapter.owner.publishEdit(current => ({ ...current, shots: kind === "removed" ? [] : [{ ...current.shots[0], id: kind === "new-shot" ? "new" : "s", imagePath: "/w/new.tiff" }] }), []);
  gate.release(); expect(await saving).toBe(false);
  expect(f.projectRef.current.shots.length).toBe(kind === "removed" ? 0 : 1);
  if (kind !== "removed") expect(f.projectRef.current.shots[0].imagePath).toBe("/w/new.tiff");
  expect(f.events).toEqual(["saved:false"]);
});
it("actual App autosave caller and actual error UI callbacks ignore old same-folder epoch rejection", async () => {
  const source = await readFile(new URL("./App.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let decl: ts.VariableDeclaration | undefined;
  const walk = (n: ts.Node) => { if (ts.isVariableDeclaration(n) && n.name.getText(ast) === "normalSaveAppCallbacks") decl = n; ts.forEachChild(n, walk); }; walk(ast);
  const ui: string[] = [];
  const bindings = { workspaceSaveStateRef: { current: "saved" }, setWorkspaceSaveState: (s: string) => ui.push(s), setAutosaveError: () => {}, setSaveErrorDialog: (s: string) => ui.push(s), setStatus: (s: string) => ui.push(s), setWorkspaceTask: () => {}, formatSaveFailureStatus };
  const callbacks = new Function(...Object.keys(bindings), ts.transpile(`const ${decl!.getText(ast)}; return normalSaveAppCallbacks;`))(...Object.values(bindings));
  const f = setup(callbacks.onError), gate = deferred(), started = deferred();
  f.api.autosaveWorkspace = async () => { started.release(); await gate.promise; throw new Error("old epoch"); };
  const oldSave = actualCaller("persistWorkspace", { normalSaveAppEnabled: true, normalSaveAppAdapterRef: { current: f.adapter }, folderPath: "/w", metadataPath: "/w/project.json" }, [f.projectRef.current]);
  await started.promise;
  const load = f.adapter.load(async () => ({ folderPath: "/w", metadataPath: "/w/project.json", folderName: "w", images: [], project: p() }), () => {});
  gate.release(); await oldSave; await load; expect(ui).toEqual([]);
  f.api.autosaveWorkspace = async () => { throw new Error("current epoch"); };
  await actualCaller("persistWorkspace", { normalSaveAppEnabled: true, normalSaveAppAdapterRef: { current: f.adapter }, folderPath: "/w", metadataPath: "/w/project.json" }, [f.projectRef.current]);
  expect(ui).toEqual(["error", "current epoch", "Save failed: current epoch"]);
});
// The normal App path is now unconditional; no obsolete switch may select a bypass.
it("does not expose the retired App mode switch", () => { expect(mod).not.toHaveProperty("normalSaveAppEnabled"); });
