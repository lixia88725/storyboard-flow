import { expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import { buildLayerAssetUrl } from "../preload/layerAssetUrl";
import { recoverFailedSave } from "./saveRecovery";
import { workspaceEffectFailure } from "./workspaceEffectFailure";
import { SaveArtifactCleanupIncompleteError } from "./saveArtifacts";
import { createNormalSaveAppAdapter } from "../../src/renderer/normalSaveAppAdapter";
import { createPendingShotFileController } from "../../src/renderer/pendingShotFileController";
import { createProject } from "../../src/shared/projectOps";
import { createBitmapLayerWriteQueue } from "../../src/renderer/bitmapLayerWriteQueue";
import { registerWorkspacePendingIpcHandlers } from "./ipc/workspacePendingHandlers";
import { moveShotsToVisiblePending } from "./pendingShotFilesService";

it("registered Pending handler returns plain incomplete publication, not an invoke rejection", async () => {
  const registered = new Map<string, (...args: any[]) => any>();
  const project = { shots: [{ id: "s", imagePath: "/synthetic/s.tiff", fileName: "s.tiff" }] };
  registerWorkspacePendingIpcHandlers({ handle: (name, handler) => { registered.set(name, handler); } }, {
    moveShotsToPending: () => moveShotsToVisiblePending("/synthetic", project, ["s"], {
      uniquePath: async () => "/synthetic/Pending/s.tiff", fingerprint: async () => "fingerprint",
      materializeShots: async () => ({ rollback: async () => { throw new Error("must not roll back"); } }),
      moveFiles: async () => ({ rollback: async () => { throw new Error("must not roll back"); } }),
      finalize: async (_files, publicationStarted) => { publicationStarted(); throw new Error("MD failed"); }
    }), restoreShotsFromPending: () => []
  });
  const result = structuredClone(await registered.get("workspace:moveShotsToPending")!({}, {}, ["s"]));
  expect(result).toMatchObject({ ok: false, error: { code: "PENDING_RECOVERY_INCOMPLETE", recoveryIncomplete: true,
    publicationOrCleanup: "started", metadata: "unknown", retainedPaths: [] } });
});

async function registeredSave(error: unknown) {
  const source = await readFile(new URL("./main.ts", import.meta.url), "utf8");
  const tree = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
  let handler: ts.CallExpression | undefined;
  const find = (n: ts.Node) => {
    if (ts.isCallExpression(n) && n.expression.getText(tree) === "ipcMain.handle" && n.arguments[0]?.getText(tree) === '"workspace:save"') handler = n;
    ts.forEachChild(n, find);
  }; find(tree);
  expect(handler).toBeDefined();
  let callback!: (...args: any[]) => any;
  const code = ts.transpileModule(handler!.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("ipcMain", "saveWorkspace", "createWorkspaceTaskProgressReporter", "workspaceEffectFailure", code)(
    { handle: (_name: string, cb: typeof callback) => { callback = cb; } },
    () => recoverFailedSave(error, { publicationOrCleanupStarted: true }), () => () => {}, workspaceEffectFailure);
  return callback;
}

for (const filename of ["preload.cjs", "preload.ts"]) {
  it(`${filename}: registered Save → plain clone → real adapter blocks completion and preserves recovery facts`, async () => {
    const save = await registeredSave(new SaveArtifactCleanupIncompleteError([new Error("EPERM")], ["/synthetic/owned-backups"]));
    let exposed: any;
    const electron = { contextBridge: { exposeInMainWorld: (_name: string, value: unknown) => { exposed = value; } },
      ipcRenderer: { invoke: async () => structuredClone(await save({ sender: {} }, {})) }, webUtils: {} };
    const source = await readFile(new URL(`../preload/${filename}`, import.meta.url), "utf8");
    const code = filename.endsWith(".ts") ? ts.transpileModule(source, { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS
    } }).outputText : source;
    vm.runInNewContext(code, { exports: {}, require: (name: string) => {
      if (name === "electron") return electron;
      if (name === "./layerAssetUrl.js") return { buildLayerAssetUrl };
      throw new Error(`Unexpected preload dependency ${name}`);
    } });
    const failure = structuredClone(await exposed.saveWorkspace({}));
    expect(failure).toMatchObject({ ok: false, error: { code: "SAVE_RECOVERY_INCOMPLETE", metadata: "unknown", retainedPaths: ["/synthetic/owned-backups"] } });
    const h0 = "0".repeat(64);
    const project = { ...createProject("Synthetic"), naming: { sceneCode: "S", artistName: "A", version: "V" },
      shots: [{ id: "s", imagePath: "/synthetic/s.tiff", fileName: "s.tiff", order: 0, swb: { version: 1, status: "owned" as const, canvasWidth: 8, canvasHeight: 6 } }],
      pendingBake: { version: 1 as const, shots: { s: { state: "pending" as const, editToken: "t1", acceptedOutputIdentity: h0 } } } };
    const success = vi.fn(), status = vi.fn(), error = vi.fn();
    const ref = { current: project };
    const adapter = createNormalSaveAppAdapter({ projectRef: ref, setProject: () => {}, queue: createBitmapLayerWriteQueue(),
      api: () => ({ saveWorkspace: async () => structuredClone(failure), autosaveWorkspace: async () => {}, readOutputIdentity: async () => h0 }),
      paths: () => ({ folderPath: "/synthetic", metadataPath: "/synthetic/project.json" }), freshToken: () => "t2",
      onSave: success, captureSaveStatus: () => status, onError: error });
    expect(await adapter.save()).toBe(false);
    expect(success).not.toHaveBeenCalled(); expect(status).not.toHaveBeenCalled();
    expect(error.mock.calls[0][0]).toMatchObject({ code: "SAVE_RECOVERY_INCOMPLETE", recoveryIncomplete: true,
      metadata: "unknown", retainedPaths: ["/synthetic/owned-backups"] });
    expect(ref.current.pendingBake!.shots.s.state).not.toBe("synced");
    const pendingFailure = workspaceEffectFailure(new (await import("./pendingShotFilesService")).PendingRecoveryIncompleteError(new Error("persist"), new Error("stopped"), true), "pending");
    const controller = createPendingShotFileController({ api: {
      moveShotsToPending: async () => structuredClone(pendingFailure), restoreShotsFromPending: async () => structuredClone(pendingFailure)
    } as any, folderPath: "/synthetic", metadataPath: "/synthetic/project.json" });
    for (const kind of ["park", "restore"] as const) await expect(controller.normalSaveEffects(kind, project, ["s"]))
      .rejects.toMatchObject({ code: "PENDING_RECOVERY_INCOMPLETE", recoveryIncomplete: true });
    await expect(controller.moveShotsToPending(project, ["s"])).rejects.toMatchObject({ code: "PENDING_RECOVERY_INCOMPLETE" });
    await expect(controller.restoreShotsFromPending(project, ["s"])).rejects.toMatchObject({ code: "PENDING_RECOVERY_INCOMPLETE" });
  });
}
