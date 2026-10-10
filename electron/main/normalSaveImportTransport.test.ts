import { expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import { decodeNormalSaveImportResult, normalSaveImportFailure } from "../shared/normalSaveImportIpc";

// Execute both production preload entrypoints. A plain business result, not a rejected
// custom Error, must leave the exposed API; renderer decoding is after BOTH boundaries.
for (const filename of ["preload.cjs", "preload.ts"]) {
  it(`${filename} exposes recovery failure as plain data until the renderer consumer`, async () => {
    const failure = normalSaveImportFailure({ message: "primary failure; rollback failure" });
    let exposed: any;
    let ordinaryError = false;
    const electron = {
      contextBridge: { exposeInMainWorld: (_name: string, api: unknown) => { exposed = api; } },
      ipcRenderer: { on: () => {}, invoke: async () => {
        if (ordinaryError) throw new Error("ordinary Import failure");
        return structuredClone(failure);
      } }, webUtils: {}
    };
    const code = await readFile(new URL(`../preload/${filename}`, import.meta.url), "utf8");
    const js = filename.endsWith(".ts") ? ts.transpileModule(code, { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS
    } }).outputText : code;
    vm.runInNewContext(js, { exports: {}, require: (name: string) => {
      if (name === "electron") return electron;
      if (name.includes("normalSaveImportIpc")) return { decodeNormalSaveImportResult };
      if (name.includes("layerAssetUrl")) return { buildLayerAssetUrl: () => "" };
      throw new Error(`Unexpected preload dependency ${name}`);
    } });
    const data = await exposed.importSwbFormat({ normalSave: true });
    expect(data).toEqual(failure);
    // This is the explicit plain-data producer seam, not an actual contextBridge launch.
    const rendererData = structuredClone(data);
    expect(() => decodeNormalSaveImportResult(rendererData)).toThrow("primary failure; rollback failure");
    try { decodeNormalSaveImportResult(rendererData); } catch (error) {
      expect(error).toMatchObject({ code: "IMPORT_RECOVERY_INCOMPLETE", recoveryIncomplete: true });
    }
    ordinaryError = true;
    await expect(exposed.importSwbFormat({})).rejects.toThrow("ordinary Import failure");
  });
}
