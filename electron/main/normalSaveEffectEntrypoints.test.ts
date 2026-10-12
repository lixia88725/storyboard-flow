import { isCertifiedPendingBakeEntry } from "../shared/pendingBakeRules";
import { expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { registerWorkspacePersistenceIpcHandlers } from "./ipc/workspacePersistenceHandlers.js";
import { createWorkspacePendingAppHandlers } from "./workspacePendingAppRuntime.js";
import { createProject } from "../../src/shared/projectOps";
import { hasPendingFileTransaction } from "./pendingFileTransactionService.js";
import { withLayerFileOperation } from "./layerFileOperationQueue.js";
const source = await readFile(new URL("./main.ts", import.meta.url), "utf8");
const tree = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
const compile = (text: string) => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const declaration = (name: string) => tree.statements.find(s => ts.isVariableStatement(s) && s.declarationList.declarations[0].name.getText(tree) === name)!.getText(tree);
function handler(channel: string, bindings: Record<string, unknown>) {
  let expression: string | undefined;
  const visit = (node: ts.Node) => { if (ts.isCallExpression(node) && node.expression.getText(tree) === "ipcMain.handle" && node.arguments[0]?.getText(tree) === JSON.stringify(channel)) expression = node.arguments[1].getText(tree); ts.forEachChild(node, visit); };
  visit(tree); expect(expression).toBeDefined();
  return new Function(...Object.keys(bindings), compile(`const actual = ${expression};`) + "return actual;")(...Object.values(bindings));
}
function registration(name: string, bindings: Record<string, unknown>) {
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => { if (ts.isCallExpression(node) && node.expression.getText(tree) === name) calls.push(node); ts.forEachChild(node, visit); };
  visit(tree); expect(calls).toHaveLength(1);
  new Function(...Object.keys(bindings), compile(calls[0].getText(tree) + ";"))(...Object.values(bindings));
}
const unknownPayload = () => ({ normalSave: true, project: { ...createProject("unknown"), shots: [{ id: "s", imagePath: "/w/s.tiff", fileName: "s.tiff", order: 0 }] }, folderPath: "/w", metadataPath: "/w/p.json" });
const admission = (io: ReturnType<typeof vi.fn>) => new Function("isCertifiedPendingBakeEntry", "readFile", compile(declaration("assertNormalSaveAdmission")) + "return payload => assertNormalSaveAdmission(payload, false);")(isCertifiedPendingBakeEntry, io);
const rejectedPayloads = () => [unknownPayload(), ...[
  { version: 1, shots: { s: { state: "unknown" } } }, { version: 17, shots: {} }, "corrupt", { version: 1, shots: { s: { state: "synced", acceptedOutputIdentity: "bad" } } }
].map(raw => ({ ...unknownPayload(), project: { ...unknownPayload().project, pendingBake: raw } }))];

it.each(["workspace:exportPhotoshopTiffs", "workspace:importSwbFormat"])("actual %s rejects unknown before ensure/Import/metadata/output", async channel => {
  const io = vi.fn(async () => { throw new Error("effect escaped admission"); });
  const invoke = handler(channel, { assertNormalSaveAdmission: (p: unknown) => admission(io)(p),
    ensureProjectLayerAssets: io, exportPhotoshopLayeredTiffs: io, projectNeedsSwbImport: () => true, withLayerFileOperation,
    importStoryboardScriptMarkdown: io, recoverFailedImport: async (e: unknown) => { throw e; } });
  for (const payload of rejectedPayloads()) {
    const before = JSON.stringify(payload);
    await expect(invoke({}, payload)).rejects.toThrow(/compatibility is unknown/);
    expect(JSON.stringify(payload)).toBe(before);
  }
  expect(io).not.toHaveBeenCalled();
});
it.each(["workspace:autosave", "workspace:ensureLayerAssets"])("actual registered %s rejects unknown before any sideeffect", async channel => {
  const io = vi.fn(async () => { throw new Error("effect escaped admission"); });
  const callbacks = new Map<string, (...args: any[]) => unknown>();
  registration("registerWorkspacePersistenceIpcHandlers", {
    ipcMain: { handle: (name: string, f: (...args: any[]) => unknown) => { callbacks.set(name, f); } },
    registerWorkspacePersistenceIpcHandlers, hasPendingFileTransaction, ensureProjectLayerAssets: io, writeProjectFiles: io, assertNormalSaveAdmission: admission(io) });
  for (const payload of rejectedPayloads()) {
    const before = JSON.stringify(payload);
    await expect(callbacks.get(channel)!({}, payload)).rejects.toThrow(/compatibility is unknown/);
    expect(JSON.stringify(payload)).toBe(before);
  }
  expect(io).not.toHaveBeenCalled();
});
it.each(["moveShotsToPending", "restoreShotsFromPending"] as const)("actual Pending %s rejects unknown before unique/mat/move/persist", async method => {
  const io = vi.fn(async () => { throw new Error("effect escaped admission"); });
  let runtime!: ReturnType<typeof createWorkspacePendingAppHandlers>;
  registration("registerWorkspacePendingIpcHandlers", { ipcMain: {},
    registerWorkspacePendingIpcHandlers: (_ipc: unknown, handlers: typeof runtime) => { runtime = handlers; },
    createWorkspacePendingAppHandlers, beginPendingFileTransaction: io, writeProjectMetadata: io, uniquePath: io,
    writeSwbMetadataToTiffs: io, assertNormalSaveAdmission: admission(io) });
  for (const payload of rejectedPayloads()) {
    const before = JSON.stringify(payload);
    await expect(runtime[method](payload, ["s"])).rejects.toThrow(/compatibility is unknown/);
    expect(JSON.stringify(payload)).toBe(before);
  }
  expect(io).not.toHaveBeenCalled();
});
