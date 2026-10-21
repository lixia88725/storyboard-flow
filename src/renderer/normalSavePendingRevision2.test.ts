import { expect, it, vi } from "vitest";
import ts from "typescript";
import { readFile, mkdtemp, mkdir, writeFile, readFile as readBytes, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import { createProject, applyProjectMatte } from "../shared/projectOps";
import * as history from "./projectHistoryController";
import { appendHistoryEntry, createSyncedHistoryStackSetter } from "./historyStackController";
import { readLayerAssetSnapshots, restoreLayerAssetSnapshots } from "./bitmapLayerHistory";
import { createBitmapLayerWriteQueue } from "./bitmapLayerWriteQueue";
import { createShotPresentationController } from "./shotPresentationController";

import { historyFixture } from "../../research/save-pending-revision2/history-fixture";
export const project = () => ({ ...createProject("P"), shots: [{ id: "s", imagePath: "/w/a.tiff", fileName: "a.tiff", order: 0, swb: { version: 1, status: "owned", canvasWidth: 4, canvasHeight: 3 }, layers: [{ id: "base", kind: "image", name: "Base", visible: true, locked: false, opacity: 1, blendMode: "normal", order: 0, bitmapPath: ".storyboard-workbench/layers/s/base.png", width: 4, height: 3 }] }] } as any);
it("finite inheritance invalidation checks whole Project dependencies, not just snapshot paths, and preserves proven edits", async () => {
  const before = project(), after = applyProjectMatte(before, "expanded", ["s"]);
  const entry = (p: any, layerAssets: any[] = []) => ({ project: p, selectedShotIds: [], fileNameSyncState: "unsynced" as const, layerAssets });
  const oldMetadataOnly = entry(before), valid = entry({ ...after, name: "before unrelated name edit" });
  const oldAssets = entry(after, [{ bitmapPath: before.shots[0].layers[0].bitmapPath, dataUrl: "old" }]);
  const filter = (history as any).invalidatePresentationHistoryEntries;
  expect(typeof filter).toBe("function");
  expect(filter([oldMetadataOnly, oldAssets, valid], after, ["s"], [before.shots[0].layers[0].bitmapPath])).toEqual([valid]);
});

it("finite invalidation rejects cross-shot shared-asset and dialogue-overlay metadata dependencies", () => {
  const after = project(); after.dialogues = [{ id: "d", shotId: "s", text: "new", order: 0 }];
  after.shots.push({ ...after.shots[0], id: "alias", layers: after.shots[0].layers.map((l: any) => ({ ...l, height: 153 })) });
  const crossShot = { ...after, shots: after.shots.map((s: any) => s.id === "alias" ? { ...s, layers: s.layers.map((l: any) => ({ ...l, height: 3 })) } : s) };
  const oldDialogue = { ...after, dialogues: [{ ...after.dialogues[0], text: "old" }] };
  const entries = [crossShot, oldDialogue].map(p => ({ project: p, selectedShotIds: [], fileNameSyncState: "synced" as const, layerAssets: [] }));
  expect(history.invalidatePresentationHistoryEntries(entries, after, ["s"], [after.shots[0].layers[0].bitmapPath])).toEqual([]);
});
it.each(["undo", "redo"])("unknown namespace blocks %s before any asset restore or metadata publication", async direction => {
  const projectRef = { current: project() }, api = { readLayerPng: vi.fn(async () => "old"), writeLayerPng: vi.fn(), deleteLayerPng: vi.fn() };
  const f = await historyFixture(projectRef, api);
  f.controller.recordUndoEntry({ project: projectRef.current, selectedShotIds: [], fileNameSyncState: "synced", layerAssets: [{ bitmapPath: "base.png", dataUrl: "old" }] });
  if (direction === "redo") await f.controller.applyUndoEntry();
  api.writeLayerPng.mockClear(); api.readLayerPng.mockClear();
  projectRef.current = { ...projectRef.current, name: "P2", pendingBake: { version: 1, shots: { s: { state: "unknown" } } } };
  const p2 = projectRef.current;
  await (direction === "undo" ? f.controller.applyUndoEntry() : f.controller.applyRedoEntry());
  expect(api.writeLayerPng).not.toHaveBeenCalled(); expect(api.readLayerPng).not.toHaveBeenCalled(); expect(projectRef.current).toBe(p2);
});

it.each([false, true])("actual inheritance first PNG write then P2 rollback failure gates same workspace only (different epoch=%s)", async differentEpoch => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pending-revision2-"));
  try {
    const projectRef = { current: project() }, original = projectRef.current, bitmap = original.shots[0].layers[0].bitmapPath;
    await mkdir(path.dirname(path.join(root, bitmap)), { recursive: true });
    const png = await sharp({ create: { width: 4, height: 3, channels: 4, background: "red" } }).png().toBuffer();
    await writeFile(path.join(root, bitmap), png);
    let writes = 0, owned = true;
    const workspaceRecoveryRequiredRef = { current: undefined as string | undefined }, workspaceSaveStateRef = { current: "saved" };
    const status = vi.fn(), update = vi.fn();
    const appSource = await readFile(new URL("./App.tsx", import.meta.url), "utf8");
    const appTree = ts.createSourceFile("App.tsx", appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let recoveryCallback!: ts.Expression;
    const findRecovery = (node: ts.Node) => { if (ts.isPropertyAssignment(node) && node.name.getText(appTree) === "onRecoveryRequired") recoveryCallback = node.initializer; ts.forEachChild(node, findRecovery); }; findRecovery(appTree);
    const { autosaveErrorReducer } = await import("./autosaveError");
    const recoveryBindings = { workspaceRecoveryRequiredRef, workspaceSaveStateRef, setWorkspaceSaveState: vi.fn(), setAutosaveError: vi.fn(), autosaveErrorReducer, setSaveErrorDialog: vi.fn() };
    const actualOnRecovery = new Function(...Object.keys(recoveryBindings), ts.transpile(`return (${recoveryCallback.getText(appTree)});`))(...Object.values(recoveryBindings));
    const onRecovery = vi.fn(actualOnRecovery);
    const api = { ensureLayerAssets: async () => {}, readLayerPng: async ({ bitmapPath }: any) => { try { return `data:image/png;base64,${(await readBytes(path.join(root, bitmapPath))).toString("base64")}`; } catch (error: any) { if (error.code === "ENOENT") return undefined; throw error; } },
      writeLayerPng: async ({ bitmapPath, dataUrl }: any) => {
        if (++writes > 1) throw new Error("rollback PNG write failed");
        await writeFile(path.join(root, bitmapPath), Buffer.from(dataUrl.split(",")[1], "base64"));
        projectRef.current = { ...original, name: "P2" }; if (differentEpoch) owned = false;
      }, deleteLayerPng: async () => {} };
    const h = await historyFixture(projectRef, api, root, () => workspaceRecoveryRequiredRef.current);
    const presentation = createShotPresentationController({ api: api as any, bitmapLayerWriteQueueRef: { current: h.queue }, createHistoryEntry: h.controller.createHistoryEntry,
      folderPath: root, metadataPath: path.join(root, "p.json"), projectRef, getRecoveryRequiredMessage: () => workspaceRecoveryRequiredRef.current, onRecoveryRequired: onRecovery,
      markShotsDirty: vi.fn(), recordUndoEntry: vi.fn(), setStatus: status, shotPresentationActionRef: { current: undefined }, updateProject: update,
      expandBitmapLayer: async () => `data:image/png;base64,${(await sharp(png).extend({ top: 75, bottom: 75, left: 0, right: 0, background: "transparent" }).png().toBuffer()).toString("base64")}` } as any);
    expect(await presentation.handleInheritSceneMatte(original, "expanded", ["s"], { expectedProject: original, isCurrent: () => owned && projectRef.current === original, isWorkspaceCurrent: () => owned } as any)).toBe(false);
    expect(projectRef.current.name).toBe("P2"); expect(update).not.toHaveBeenCalled();
    if (differentEpoch) { expect(onRecovery).not.toHaveBeenCalled(); expect(status).not.toHaveBeenCalled(); }
    else {
      expect(onRecovery).toHaveBeenCalledOnce(); expect(workspaceRecoveryRequiredRef.current).toContain("rollback"); expect(workspaceSaveStateRef.current).toBe("error");
      // Execute the production App admission expression, not an invented gate.
      const source = await readFile(new URL("./App.tsx", import.meta.url), "utf8");
      const tree = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      let admission!: ts.ArrowFunction;
      const visit = (node: ts.Node) => { if (ts.isPropertyAssignment(node) && node.name.getText(tree) === "assertAdmission" && ts.isArrowFunction(node.initializer)) admission = node.initializer; ts.forEachChild(node, visit); }; visit(tree);
      const assertAdmission = new Function("workspaceRecoveryRequiredRef", "needsSwbImport", ts.transpile(`return (${admission.getText(tree)});`))(workspaceRecoveryRequiredRef, false);
      const { createNormalSaveAppAdapter } = await import("./normalSaveAppAdapter");
      projectRef.current = { ...projectRef.current, pendingBake: { version: 1, shots: { s: { state: "synced", acceptedOutputIdentity: "0".repeat(64) } } } };
      const saveWorkspace = vi.fn(), autosaveWorkspace = vi.fn();
      const adapter = createNormalSaveAppAdapter({ projectRef, setProject: () => {}, queue: h.queue, freshToken: () => "fresh", assertAdmission,
        api: () => ({ saveWorkspace, autosaveWorkspace, readOutputIdentity: async () => "0".repeat(64) }), paths: () => ({ folderPath: root, metadataPath: path.join(root, "p.json") }), onSave: () => {}, onError: () => {} });
      expect(await adapter.save()).toBe(false); expect(await adapter.autosave(projectRef.current)).toBe(false);
      expect(saveWorkspace).not.toHaveBeenCalled(); expect(autosaveWorkspace).not.toHaveBeenCalled();
      expect(adapter.owner.lastError).toBeDefined();
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
