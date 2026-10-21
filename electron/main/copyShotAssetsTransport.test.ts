import { expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import { decodeCopyShotAssetsResult } from "../shared/copyShotAssetsIpc";
import { buildLayerAssetUrl } from "../preload/layerAssetUrl";

// Production preload execution with simulated clone boundaries, not real Electron.
for (const filename of ["preload.cjs", "preload.ts"]) {
  it(`${filename} keeps Copy incomplete effects plain until renderer decoding`, async () => {
    const failure = { ok: false as const, error: { code: "COPY_RECOVERY_INCOMPLETE" as const,
      message: "preview failed; cleanup EPERM; retained /owned/layer.png",
      retainedEffects: [{ filePath: "/owned/layer.png", kind: "layer" as const, effect: "committed" as const }] } };
    let exposed: any;
    const electron = { contextBridge: { exposeInMainWorld: (_name: string, value: unknown) => { exposed = value; } },
      ipcRenderer: { on: () => {}, invoke: async () => structuredClone(failure) }, webUtils: {} };
    const source = await readFile(new URL(`../preload/${filename}`, import.meta.url), "utf8");
    const code = filename.endsWith(".ts") ? ts.transpileModule(source, { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS
    } }).outputText : source;
    vm.runInNewContext(code, { exports: {}, require: (name: string) => {
      if (name === "electron") return electron;
      if (name === "./layerAssetUrl.js") return { buildLayerAssetUrl };
      throw new Error(`Unexpected preload dependency ${name}`);
    } });
    const value = structuredClone(await exposed.copyShotAssets({}));
    expect(value).toEqual(failure);
    try { decodeCopyShotAssetsResult(value); throw new Error("Failure was accepted as a copied shot"); }
    catch (error) { expect(error).toMatchObject({ code: "COPY_RECOVERY_INCOMPLETE", recoveryIncomplete: true,
      retainedEffects: failure.error.retainedEffects, message: failure.error.message }); }
  });
}
it("both compile targets use identical Copy protocol definitions", async () => {
  expect(await readFile(new URL("../shared/copyShotAssetsIpc.ts", import.meta.url), "utf8"))
    .toBe(await readFile(new URL("../../src/shared/copyShotAssetsIpc.ts", import.meta.url), "utf8"));
});
