import ts from "typescript";
import { readFile } from "node:fs/promises";
import { vi } from "vitest";
import * as history from "../../src/renderer/projectHistoryController";
import { appendHistoryEntry, createSyncedHistoryStackSetter } from "../../src/renderer/historyStackController";
import { readLayerAssetSnapshots, restoreLayerAssetSnapshots, restoreHistoryAssetTransaction, HistoryAssetRestoreFailure } from "../../src/renderer/bitmapLayerHistory";
import { createBitmapLayerWriteQueue } from "../../src/renderer/bitmapLayerWriteQueue";
export async function historyFixture(projectRef: any, api?: any, folder = "/w", gate?: () => string | undefined) {
  const source = await readFile(new URL("../../src/renderer/projectHistoryController.ts", import.meta.url), "utf8");
  const tree = ts.createSourceFile("history.ts", source, ts.ScriptTarget.Latest, true);
  const declaration = tree.statements.find(n => ts.isVariableStatement(n) && n.declarationList.declarations[0].name.getText(tree) === "useProjectHistoryController")!;
  const { useProjectHistoryController: _hook, ...helpers } = history;
  const bindings = { ...helpers, readLayerAssetSnapshots, restoreLayerAssetSnapshots, restoreHistoryAssetTransaction, HistoryAssetRestoreFailure, appendHistoryEntry, useRef: (current: unknown) => ({ current }), useState: (value: unknown) => [value, () => {}],
    useSyncedHistoryStackController: ({ stackRef, setStack }: any) => createSyncedHistoryStackSetter(stackRef, setStack) };
  const hook = new Function(...Object.keys(bindings), ts.transpile(`${declaration.getText(tree).replace(/^export /, "")} return useProjectHistoryController;`, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }))(...Object.values(bindings));
  const queue = createBitmapLayerWriteQueue(), status = vi.fn();
  const controller = hook({ projectRef, api, bitmapLayerWriteQueueRef: { current: queue }, maxEntries: 20, isImageImportLocked: () => false,
    getRecoveryRequiredMessage: gate, fileNameSyncStateRef: { current: "synced" }, folderPathRef: { current: folder }, selectedShotIdsRef: { current: ["s"] },
    markShotsDirty: () => {}, selectShotsByIds: () => {}, scriptImportCheckIdRef: { current: 0 }, setAutosaveRevision: () => {}, setFileNameSyncState: () => {}, setProject: () => {}, setScriptImportNeeded: () => {}, setStatus: status, setWorkspaceSaveState: () => {} });
  return { controller, queue, status };
}
