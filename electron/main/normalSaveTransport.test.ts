import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";
const source = await readFile(new URL("./main.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
it("actual main ACK carries actual filename/fingerprint and renamed synced shot even when no bake selected", async () => {
  const stmt = ast.statements.find(s => ts.isVariableStatement(s) && s.declarationList.declarations.some(d => d.name.getText(ast) === "normalSaveOutputAcks"))!;
  const code = ts.transpile(stmt.getText(ast));
  const actual = new Function("createHash", "readFile", "shouldWriteSwbMetadata", `${code}; return normalSaveOutputAcks;`)(
    () => ({ update: () => ({ digest: () => "1".repeat(64) }) }), async () => Buffer.from("fixture"), () => true);
  const shot = { id: "s", imagePath: "/b.tiff", fileName: "b.tiff", swb: { status: "owned", baseFingerprint: "actual-fp" } };
  const result = await actual({ project: { shots: [shot], pendingBake: { shots: { s: { state: "synced" } } } }, renamePlan: [{ shotId: "s", fromPath: "/a.tiff", finalPath: "/b.tiff" }] }, { shots: [shot] }, new Set());
  expect(result).toEqual([{ shotId: "s", capturedToken: undefined, sourcePath: "/a.tiff", targetPath: "/b.tiff", outputHash: "1".repeat(64), fileName: "b.tiff", baseFingerprint: "actual-fp" }]);
});
it("actual main read-only identity handler hashes whole bytes and rejects invalid paths", async () => {
  let fn: ts.Node | undefined;
  const walk = (n: ts.Node) => {
    if (ts.isCallExpression(n) && n.expression.getText(ast) === "ipcMain.handle" && n.arguments[0]?.getText(ast) === '"workspace:readOutputIdentity"') fn = n.arguments[1];
    ts.forEachChild(n, walk);
  }; walk(ast);
  const handler = new Function("path", "createHash", "readFile", ts.transpile(`const handler = ${fn!.getText(ast)}; return handler;`))(path, createHash, readFile);
  const dir = await mkdtemp(path.join(os.tmpdir(), "normal-main-chain-identity-"));
  try {
    const file = path.join(dir, "fixture.tiff"); const bytes = Buffer.from("synthetic whole-file hash fixture"); await writeFile(file, bytes);
    expect(await handler(undefined, file)).toBe(createHash("sha256").update(bytes).digest("hex"));
    await expect(handler(undefined, "relative.tiff")).rejects.toThrow("Invalid working TIFF path");
    await expect(handler(undefined, path.join(dir, "project.json"))).rejects.toThrow("Invalid working TIFF path");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
it.each(["ts", "cjs"])("actual preload %s passes typed opt-in payload and optional-token ACK without rewriting", async extension => {
  let bridge: any; const calls: unknown[] = [];
  const result = { normalSaveOutputs: [{ shotId: "s", sourcePath: "/a.tiff", targetPath: "/b.tiff", outputHash: "1".repeat(64) }],
    normalSaveDeletions: [{ shotId: "deleted", sourcePath: "/original/deleted.tiff" }] };
  const requireFixture = (id: string) => id === "electron" ? {
    contextBridge: { exposeInMainWorld: (_: string, api: unknown) => { bridge = api; } },
    ipcRenderer: { invoke: (channel: string, payload: unknown) => { calls.push([channel, payload]); return Promise.resolve(result); } }, webUtils: {}
  } : { buildLayerAssetUrl: () => "fixture" };
  const source = await readFile(new URL(`../preload/preload.${extension}`, import.meta.url), "utf8");
  const code = extension === "ts" ? ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText : source;
  new Function("require", "exports", code)(requireFixture, {});
  const payload = { project: {}, folderPath: "/w", metadataPath: "/w/project.json", normalSave: true, dirtyShotIds: [] };
  expect(await bridge.saveWorkspace(payload)).toBe(result);
  expect(calls).toEqual([["workspace:save", payload]]);
});
