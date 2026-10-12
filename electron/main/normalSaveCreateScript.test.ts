import { appCallerAdapterScope, createAppRootActor } from "../../src/renderer/appCallerAdapterScope";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("react", () => ({ useState: (v: unknown) => [v, () => {}], useRef: (v: unknown) => ({ current: v }),
  useEffect: (f: () => void) => f(), useCallback: (f: unknown) => f, useMemo: (f: () => unknown) => f() }));
const fault = vi.hoisted(() => ({ openSuffix: "", unlinkSuffix: "", beforeOpen: undefined as undefined | ((p: string) => Promise<void>) }));
vi.mock("node:fs/promises", async importActual => {
  const real = await importActual<typeof import("node:fs/promises")>();
  return { ...real, open: async (...args: Parameters<typeof real.open>) => {
    await fault.beforeOpen?.(String(args[0]));
    if (fault.openSuffix && String(args[0]).endsWith(fault.openSuffix)) throw new Error("injected create write failure");
    return real.open(...args);
  }, unlink: async (...args: Parameters<typeof real.unlink>) => {
    if (fault.unlinkSuffix && String(args[0]).endsWith(fault.unlinkSuffix)) throw new Error("injected rollback failure");
    return real.unlink(...args);
  } };
});
import { registerWorkspaceScriptIpcHandlers } from "./ipc/workspaceScriptHandlers";
import { ImportRecoveryIncompleteError } from "./importRecovery";
import { decodeNormalSaveImportResult } from "../shared/normalSaveImportIpc";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import ts from "typescript";
import vm from "node:vm";
import { createProject } from "../../src/shared/projectOps";
import { createNormalSaveAppAdapter } from "../../src/renderer/normalSaveAppAdapter";
import { createBitmapLayerWriteQueue } from "../../src/renderer/bitmapLayerWriteQueue";
import { useProjectHistoryController } from "../../src/renderer/projectHistoryController";
import { autosaveErrorReducer } from "../../src/renderer/autosaveError";
import { createProjectFromStoryboardScriptMarkdown } from "./storyboardScriptProject";

const dirs: string[] = [];
afterEach(async () => { fault.openSuffix = ""; fault.unlinkSuffix = ""; fault.beforeOpen = undefined; await Promise.all(dirs.splice(0).map(p => fs.rm(p, { recursive: true, force: true }))); });
const setup = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "b2-create-")); dirs.push(root);
  const sourceMarkdownPath = path.join(root, "source.md"), targetFolderPath = path.join(root, "target");
  await fs.mkdir(targetFolderPath); await fs.writeFile(sourceMarkdownPath, "1. Opening\n2. Close up\n");
  return { sourceMarkdownPath, targetFolderPath, blankShotPreset: "9:16" as const, normalSave: true as const };
};
it("normal script create persists actual Image PNGs and pending token/H0 for every real new TIFF", async () => {
  const options = await setup();
  const scan = await createProjectFromStoryboardScriptMarkdown(options);
  const project = scan.project!;
  expect(project.shots).toHaveLength(2);
  const persisted = JSON.parse(await fs.readFile(scan.metadataPath, "utf8"));
  expect(persisted).toEqual(project);
  for (const shot of project.shots) {
    const entry = persisted.pendingBake?.shots[shot.id];
    expect(entry?.state).toBe("pending"); expect(entry?.editToken).toEqual(expect.any(String));
    expect(entry?.acceptedOutputIdentity).toBe(createHash("sha256").update(await fs.readFile(shot.imagePath)).digest("hex"));
    const png = await sharp(path.join(scan.folderPath, shot.layers![0].bitmapPath)).metadata();
    expect(png).toMatchObject({ format: "png", width: 1080, height: 1920 });
  }
  expect(await fs.readFile(path.join(scan.folderPath, "storyboard-script.md"), "utf8")).toBe("1. Opening\n2. Close up\n");
});

it("registered Create handler transports recovery-incomplete as plain data decoded only in renderer", async () => {
  const handlers = new Map<string, Function>();
  registerWorkspaceScriptIpcHandlers({ handle: (name: string, handler: Function) => { handlers.set(name, handler); } } as never, {
    inspectStoryboardScript: async () => ({}), addRecentFolder: async () => { throw new Error("must not add failed create"); },
    ensureStoryboardScriptMarkdown: async () => false,
    createFromStoryboardScript: async () => { throw new ImportRecoveryIncompleteError([new Error("write failed"), new Error("rollback failed")]); }
  });
  const result = structuredClone(await handlers.get("workspace:createFromStoryboardScript")!({}, { normalSave: true }));
  expect(result).toMatchObject({ ok: false, error: { code: "IMPORT_RECOVERY_INCOMPLETE" } });
  expect(() => decodeNormalSaveImportResult(result)).toThrow("rollback failed");
});

it("JSON creation failure after required MD rolls back all owned files and leaves the empty destination reusable", async () => {
  const options = await setup(); fault.openSuffix = "storyboard.project.json";
  await expect(createProjectFromStoryboardScriptMarkdown(options)).rejects.toThrow("injected create write failure");
  expect(await fs.readdir(options.targetFolderPath)).toEqual([]);
});

it("partial asset creation and required MD failure remove only owned new files", async () => {
  for (const suffix of ["layer-image.png", "storyboard-script.md"]) {
    const options = await setup(); fault.openSuffix = suffix;
    await expect(createProjectFromStoryboardScriptMarkdown(options)).rejects.toThrow("injected create write failure");
    expect(await fs.readdir(options.targetFolderPath)).toEqual([]);
  }
});

it("real JSON failure plus TIFF unlink failure preserves both errors in the existing recovery boundary", async () => {
  const options = await setup(); fault.openSuffix = "storyboard.project.json"; fault.unlinkSuffix = "_0.tiff";
  await expect(createProjectFromStoryboardScriptMarkdown(options)).rejects.toThrow("Import recovery incomplete");
  expect(await fs.readFile(path.join(options.targetFolderPath, "script_shot_0001_0.tiff"))).toBeInstanceOf(Buffer);
  await expect(fs.stat(path.join(options.targetFolderPath, "storyboard-script.md"))).rejects.toMatchObject({ code: "ENOENT" });
});

it("external MD appearing at persistence admission is retained with zero JSON installation", async () => {
  const options = await setup();
  const md = path.join(options.targetFolderPath, "storyboard-script.md");
  fault.beforeOpen = async p => { if (p === md) await fs.writeFile(md, "1. Outside-new\n"); };
  await expect(createProjectFromStoryboardScriptMarkdown(options)).rejects.toMatchObject({ code: "EEXIST" });
  expect(await fs.readFile(md, "utf8")).toBe("1. Outside-new\n");
  await expect(fs.stat(path.join(options.targetFolderPath, ".storyboard-workbench/storyboard.project.json"))).rejects.toMatchObject({ code: "ENOENT" });
  expect(await fs.readdir(options.targetFolderPath)).toEqual(["storyboard-script.md"]);
});

it("real create rollback failure traverses registered result→renderer owner→actual App recovery callback and gates History/Save/Close", async () => {
  const options = await setup(); fault.openSuffix = "storyboard.project.json"; fault.unlinkSuffix = "_0.tiff";
  const handlers = new Map<string, Function>();
  registerWorkspaceScriptIpcHandlers({ handle: (name: string, fn: Function) => { handlers.set(name, fn); } } as never, {
    createFromStoryboardScript: createProjectFromStoryboardScriptMarkdown, inspectStoryboardScript: async () => ({}), addRecentFolder: async () => {}, ensureStoryboardScriptMarkdown: async () => false
  });
  const source = await fs.readFile(new URL("../../src/renderer/App.tsx", import.meta.url), "utf8");
  const tree = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let recoveryExpression = "", closeExpression = "";
  const visit = (n: ts.Node) => {
    if (ts.isPropertyAssignment(n) && n.name.getText(tree) === "onImportRecoveryRequired") recoveryExpression = n.initializer.getText(tree);
    if (ts.isCallExpression(n) && n.expression.getText(tree) === "window.storyboard.onSaveAndCloseRequested") closeExpression = n.arguments[0].getText(tree);
    ts.forEachChild(n, visit);
  }; visit(tree);
  const recovery = { current: undefined as string | undefined }, saveState = { current: "saved" };
  const recoveryBindings = { workspaceRecoveryRequiredRef: recovery, workspaceSaveStateRef: saveState, setWorkspaceSaveState: () => {},
    setAutosaveError: () => {}, setSaveErrorDialog: () => {}, autosaveErrorReducer };
  let onRecovery!: (message: string) => void;
  const ref = { current: createProject("old") }, queue = createBitmapLayerWriteQueue(), statuses: string[] = [];
  let writes = 0;
  const adapter = await createAppRootActor({ projectRef: ref, setProject: () => {}, queue, freshToken: () => "t",
    paths: () => ({ folderPath: options.targetFolderPath, metadataPath: path.join(options.targetFolderPath, ".storyboard-workbench/storyboard.project.json") }),
    assertAdmission: () => { if (recovery.current) throw new Error(recovery.current); }, assertImportAdmission: () => { if (recovery.current) throw new Error(recovery.current); },
    onImportRecoveryRequired: message => onRecovery(message), onSave: () => {}, onError: () => {},
    api: () => ({ createFromStoryboardScript: async p => structuredClone(await handlers.get("workspace:createFromStoryboardScript")!({}, p)),
      readOutputIdentity: async () => "a".repeat(64), saveWorkspace: async p => p, autosaveWorkspace: async () => { writes++; } }) });
  const recoveryScope = appCallerAdapterScope({ ...recoveryBindings, normalSaveAppAdapterRef: { current: adapter } });
  onRecovery = new Function(...Object.keys(recoveryScope), ts.transpile(`return (${recoveryExpression});`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(recoveryScope));
  const history = useProjectHistoryController({ isImageImportLocked: () => false, getRecoveryRequiredMessage: () => recovery.current,
    api: { readLayerPng: async () => { throw new Error("first asset effect forbidden"); }, writeLayerPng: async () => { writes++; }, deleteLayerPng: async () => { writes++; } } as never,
    bitmapLayerWriteQueueRef: { current: queue }, fileNameSyncStateRef: { current: "synced" }, folderPathRef: { current: options.targetFolderPath },
    maxEntries: 8, markShotsDirty: () => {}, projectRef: ref, scriptImportCheckIdRef: { current: 0 }, selectedShotIdsRef: { current: [] }, selectShotsByIds: () => {},
    setAutosaveRevision: () => {}, setFileNameSyncState: () => {}, setProject: () => {}, setScriptImportNeeded: () => {}, setStatus: s => statuses.push(s), setWorkspaceSaveState: () => {},
    publishProject: (p, ids) => adapter.owner.publishEdit(p, ids) });
  history.recordUndoEntry(await history.createHistoryEntry([]));
  expect(await adapter.createFromScript({ ...options, isCurrent: () => true, published: () => { throw new Error("failed create cannot publish"); } })).toBe(false);
  expect(recovery.current).toMatch(/recovery incomplete/); expect(saveState.current).toBe("error");
  await history.applyUndoEntry(); expect(statuses.at(-1)).toBe(recovery.current);
  expect(await adapter.save()).toBe(false); expect(await adapter.autosave(ref.current)).toBe(false); expect(writes).toBe(0);
  let finish!: (value: unknown) => void; const closed = new Promise(resolve => { finish = resolve; });
  const closeBindings = appCallerAdapterScope({ normalSaveAppAdapterRef: { current: adapter }, handleSaveProject: () => adapter.save(), window: { storyboard: { finishSaveAndClose: async (value: unknown) => { finish(value); } } }, setStatus: () => {} });
  new Function(...Object.keys(closeBindings), ts.transpile(`return (${closeExpression});`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(closeBindings))({ requestId: "b2-failed" });
  expect(await closed).toEqual({ requestId: "b2-failed", saved: false });
});

for (const filename of ["preload.cjs", "preload.ts"]) {
  it(`B2 ${filename} forwards the raw Create recovery data until renderer decode`, async () => {
    let exposed: any, failOrdinary = false;
    const data = { ok: false, error: { code: "IMPORT_RECOVERY_INCOMPLETE", message: "primary Create + rollback failed" } };
    const electron = { contextBridge: { exposeInMainWorld: (_name: string, api: unknown) => { exposed = api; } }, webUtils: {},
      ipcRenderer: { on: () => {}, invoke: async (name: string) => { expect(name).toBe("workspace:createFromStoryboardScript"); if (failOrdinary) throw new Error("ordinary Create failure"); return structuredClone(data); } } };
    const source = await fs.readFile(new URL(`../preload/${filename}`, import.meta.url), "utf8");
    const code = filename.endsWith(".ts") ? ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText : source;
    vm.runInNewContext(code, { exports: {}, require: (name: string) => {
      if (name === "electron") return electron;
      if (name.includes("layerAssetUrl")) return { buildLayerAssetUrl: () => "" };
      throw new Error(`Unexpected preload dependency ${name}`);
    } });
    const returned = await exposed.createFromStoryboardScript({ normalSave: true });
    expect(returned).toEqual(data);
    expect(() => decodeNormalSaveImportResult(structuredClone(returned))).toThrow("primary Create + rollback failed");
    failOrdinary = true; await expect(exposed.createFromStoryboardScript({})).rejects.toThrow("ordinary Create failure");
  });
}

it("existing TIFF, existing metadata, and a script file cannot be used as an empty target or overwritten", async () => {
  for (const name of ["script_shot_0001_0.tiff", ".storyboard-workbench", "storyboard-script.md"]) {
    const options = await setup(); const target = path.join(options.targetFolderPath, name);
    await fs.writeFile(target, "outside-original");
    await expect(createProjectFromStoryboardScriptMarkdown(options)).rejects.toThrow("Choose an empty folder");
    expect(await fs.readFile(target, "utf8")).toBe("outside-original");
    expect(await fs.readdir(options.targetFolderPath)).toEqual([name]);
  }
});
