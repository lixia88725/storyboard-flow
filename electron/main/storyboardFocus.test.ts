import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, it, vi } from "vitest";
import { createUserDataRuntime } from "./userDataRuntime";
import ts from "typescript";
import { registerWorkspacePersistenceIpcHandlers } from "./ipc/workspacePersistenceHandlers";

it("actual CJS bridge has no AI surface and keeps normal Pending IPC", async () => {
  let exposed: Record<string, Function> | undefined;
  const invoke = vi.fn(async () => ({ ok: true }));
  vm.runInNewContext(readFileSync("electron/preload/preload.cjs", "utf8"), {
    require: (name: string) => {
      if (name !== "electron") throw new Error(`Unexpected dependency: ${name}`);
      return { contextBridge: { exposeInMainWorld: (name: string, api: Record<string, Function>) => {
        expect(name).toBe("storyboard"); exposed = api;
      } }, ipcRenderer: { invoke, sendSync: vi.fn(), on: vi.fn(), removeListener: vi.fn() }, webUtils: { getPathForFile: vi.fn() } };
    }
  });
  expect(exposed).toBeDefined();
  expect(exposed).not.toHaveProperty("ai");
  const payload = { folderPath: "/synthetic", project: { shots: [] }, metadataPath: "/synthetic/project.json" };
  await exposed!.moveShotsToPending(payload, ["shot"]);
  await exposed!.restoreShotsFromPending(payload, ["shot"]);
  expect(invoke.mock.calls).toEqual([
    ["workspace:moveShotsToPending", payload, ["shot"]],
    ["workspace:restoreShotsFromPending", payload, ["shot"]]
  ]);
});

it("user data runtime exposes only normal tool settings, no AI store factories", () => {
  const options = { userDataPath: () => "/synthetic", readToolRadialMenu: vi.fn(), writeToolRadialMenu: vi.fn(),
    crypto: { decryptString: vi.fn(), encryptString: vi.fn(), isEncryptionAvailable: vi.fn() } };
  const runtime = createUserDataRuntime(options);
  expect(Object.keys(runtime).sort()).toEqual(["readToolRadialMenu", "writeToolRadialMenu"]);
  expect(options.crypto.decryptString).not.toHaveBeenCalled();
  expect(options.crypto.encryptString).not.toHaveBeenCalled();
});

it("production main composition imports normal Pending but no AI service or registration", () => {
  const source = ts.createSourceFile("main.ts", readFileSync("electron/main/main.ts", "utf8"), ts.ScriptTarget.Latest, true);
  const imports = source.statements.filter(ts.isImportDeclaration).map(statement => (statement.moduleSpecifier as ts.StringLiteral).text);
  expect(imports).toContain("./ipc/workspacePendingHandlers.js");
  expect(imports).toContain("./pendingFileTransactionService.js");
  expect(imports.filter(module => module.startsWith("./ai/") || /aiPromotion|ipc\/aiHandlers/.test(module))).toEqual([]);
});

it("retired AI preparation cannot re-enter the ordinary asset initializer", async () => {
  const callbacks = new Map<string, Function>();
  const ensureProjectLayerAssets = vi.fn();
  const writeProjectFiles = vi.fn();
  const assertProvisionalAdmission = vi.fn();
  const ports = { ensureProjectLayerAssets, writeProjectFiles, assertProvisionalAdmission };
  registerWorkspacePersistenceIpcHandlers({ handle: (name, callback) => callbacks.set(name, callback) }, ports);
  const payload = { folderPath: "/synthetic", metadataPath: "/synthetic/project.json", project: {},
    normalSaveAiPromotion: { candidateId: "retired", shotId: "shot" } };
  await expect(callbacks.get("workspace:ensureLayerAssets")!({}, payload)).rejects.toThrow(/no longer supported/);
  expect(ensureProjectLayerAssets).not.toHaveBeenCalled();
  expect(writeProjectFiles).not.toHaveBeenCalled();
  expect(assertProvisionalAdmission).not.toHaveBeenCalled();
});
