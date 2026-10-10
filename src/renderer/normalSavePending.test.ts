import ts from "typescript";
import { createNormalSaveAppAdapter } from "./normalSaveAppAdapter";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import type { NormalSaveOutputAck } from "../../electron/normalSaveTransport";
import { createPendingShotFileController } from "./pendingShotFileController";
import { createWorkspacePendingAppHandlers } from "../../electron/main/workspacePendingAppRuntime";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { expect, it, vi } from "vitest";
import { createProject, parkShotGroup, restoreParkedShotGroup } from "../shared/projectOps";
import { useStoryboardDragEndController } from "./storyboardDragEndController";
import { createNormalSaveProjectOwner } from "./normalSaveProjectOwner";
import { createBitmapLayerWriteQueue } from "./bitmapLayerWriteQueue";
const h0 = "0".repeat(64), h1 = "1".repeat(64);
const project = () => ({ ...createProject("P"), shots: [{ id: "s", imagePath: "/w/a.tiff", fileName: "a.tiff", order: 0 }], pendingBake: { version: 1 as const, shots: { s: { state: "pending" as const, editToken: "t1", acceptedOutputIdentity: h0 } } } });
const deferred = () => { let release!: () => void; const promise = new Promise<void>(r => release = r); return { promise, release }; };
function setup() {
  const projectRef = { current: project() }; const queue = createBitmapLayerWriteQueue();
  const persist = vi.fn(async (_p: any) => {});
  const readIdentity = vi.fn(async (s: { imagePath: string }) => s.imagePath.includes("Pending") ? h1 : h0);
  const owner = createNormalSaveProjectOwner({ projectRef, setProject: () => {}, queue, freshToken: () => "t2", readIdentity, persist, output: async () => [] });
  const effect = vi.fn(async () => [{ shotId: "s", sourcePath: "/w/a.tiff", targetPath: "/w/Pending/a.tiff", fileName: "a.tiff", capturedToken: "t1", outputHash: h1 }]);
  return { owner, projectRef, queue, persist, effect, readIdentity };
}
it("Pending materialization merges P2 and t2, persists it and holds the queue through required persistence", async () => {
  const f = setup(), materialize = deferred(), md = deferred();
  f.effect.mockImplementation(async () => { await materialize.promise; return [{ shotId: "s", sourcePath: "/w/a.tiff", targetPath: "/w/Pending/a.tiff", fileName: "a.tiff", capturedToken: "t1", outputHash: h1 }]; });
  f.persist.mockImplementation(async () => md.promise);
  const pending = (f.owner as any).pending((p: any) => parkShotGroup(p, ["s"]), ["s"], true, f.effect);
  await new Promise(r => setTimeout(r, 5)); f.owner.publishEdit(p => ({ ...p, name: "P2" }), ["s"]);
  materialize.release(); await new Promise(r => setTimeout(r, 5));
  let successor = false; const next = f.queue.runExclusive(async () => { successor = true; });
  expect(successor).toBe(false); expect(f.persist.mock.calls[0][0].name).toBe("P2");
  expect(f.projectRef.current.shots[0].imagePath).toBe("/w/a.tiff");
  expect(f.projectRef.current.pendingBake.shots.s).toMatchObject({ state: "pending", editToken: "t2", acceptedOutputIdentity: h0 });
  md.release(); expect(await pending).toBe(true); await next; expect(successor).toBe(true);
  expect(f.projectRef.current.parkedShots?.[0].imagePath).toBe("/w/Pending/a.tiff");
  expect(f.projectRef.current.pendingBake.shots.s).toMatchObject({ state: "pending", editToken: "t2", acceptedOutputIdentity: h1 });
});
it("actual controller and runtime acknowledge bytes after real TIFF materialization and move", async () => {
  const folderPath = await mkdtemp(path.join(os.tmpdir(), "normal-pending-"));
  try {
    const imagePath = path.join(folderPath, "a.tiff"), metadataPath = path.join(folderPath, "p.json");
    await sharp({ create: { width: 2, height: 2, channels: 4, background: "white" } }).tiff().toFile(imagePath);
    const hash = async (p: string) => createHash("sha256").update(await readFile(p)).digest("hex");
    const p = project(); p.shots[0].imagePath = imagePath; p.pendingBake.shots.s.acceptedOutputIdentity = await hash(imagePath);
    const runtime = createWorkspacePendingAppHandlers({
      materializeShots: async () => { await sharp({ create: { width: 2, height: 2, channels: 4, background: "red" } }).tiff({ compression: "none" }).toFile(imagePath + ".new"); const bytes = await readFile(imagePath + ".new"); await writeFile(imagePath, bytes); return { rollback: async () => {} }; },
      beginTransaction: async () => ({ commit: async () => {}, rollback: async () => {} }),
      persistProject: async (_path, p) => { await writeFile(metadataPath, JSON.stringify(p)); }, uniquePath: async (dir, name) => path.join(dir, name)
    });
    const controller = createPendingShotFileController({ api: runtime as any, folderPath, metadataPath });
    const acks: NormalSaveOutputAck[] = await (controller as any).normalSaveEffects("park", parkShotGroup(p, ["s"]), ["s"]);
    expect(acks[0]).toMatchObject({ shotId: "s", sourcePath: imagePath, targetPath: path.join(folderPath, "Pending/a.tiff"), capturedToken: "t1" });
    expect(acks[0].outputHash).toBe(await hash(acks[0].targetPath));
    expect(acks[0].outputHash).not.toBe(p.pendingBake.shots.s.acceptedOutputIdentity);
    expect((await sharp(acks[0].targetPath).raw().toBuffer())[0]).toBe(255);
    expect((await sharp(acks[0].targetPath).raw().toBuffer())[1]).toBe(0);
  } finally { await rm(folderPath, { recursive: true, force: true }); }
});
it("load migrates supported old parked shots inside the reader domain without queue reentry", async () => {
  const f = setup(), events: string[] = []; const parked = parkShotGroup(project(), ["s"]);
  const api: any = { readOutputIdentity: async (p: string) => p.includes("Pending") ? h1 : h0,
    autosaveWorkspace: async (payload: any) => { events.push(`persist:${payload.folderPath}`); return payload; },
    moveShotsToPending: async (payload: any) => { expect(payload.normalSave).toBe(true); events.push("materialize-move"); return [{ shotId: "s", imagePath: "/w/Pending/a.tiff", fileName: "a.tiff", normalSaveOutput: await f.effect().then(a => a[0]) }]; },
    restoreShotsFromPending: vi.fn(), saveWorkspace: vi.fn() };
  let paths = { folderPath: "/old", metadataPath: "/old/p.json" };
  const adapter = createNormalSaveAppAdapter({ projectRef: f.projectRef, setProject: () => {}, queue: f.queue, freshToken: () => "t2", api: () => api, paths: () => paths, onError: () => {}, onSave: () => {} });
  const loaded = await adapter.load(async () => { events.push("read"); return { folderPath: "/w", metadataPath: "/w/p.json", folderName: "w", images: [], project: parked }; }, () => { paths = { folderPath: "/w", metadataPath: "/w/p.json" }; events.push("scan-publish"); });
  expect(loaded).toBe(true); expect(events).toEqual(["read", "scan-publish", "materialize-move", "persist:/w"]);
  expect(f.projectRef.current.parkedShots?.[0].imagePath).toBe("/w/Pending/a.tiff");
});
it("actual App Pending callback delegates the whole transition rather than only IPC", async () => {
  const source = await readFile(new URL("./App.tsx", import.meta.url), "utf8");
  const tree = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration: ts.VariableDeclaration | undefined;
  const visit = (n: ts.Node) => { if (ts.isVariableDeclaration(n) && n.name.getText(tree) === "pendingTransition") declaration = n; ts.forEachChild(n, visit); }; visit(tree);
  expect(declaration, "actual App Pending domain callback absent").toBeDefined();
  const pending = vi.fn(async () => false);
  const callback = new Function("useCallback", "normalSaveAppAdapterRef", ts.transpile(`const ${declaration!.getText(tree)}; return pendingTransition;`))((fn: unknown) => fn, { current: { pending } });
  const update = (p: any) => parkShotGroup(p, ["s"]);
  expect(await callback("park", update, ["s"])).toBe(false); expect(pending).toHaveBeenCalledWith("park", update, ["s"]);
});
it.each(["path", "scope", "delete-recreate"])("Pending late ACK cannot overwrite a %s lifecycle change", async change => {
  const f = setup(), gate = deferred(); const base = f.effect.getMockImplementation()!;
  f.effect.mockImplementation(async () => { await gate.promise; return base(); });
  const operation = f.owner.pending(p => parkShotGroup(p, ["s"]), ["s"], true, f.effect);
  await new Promise(r => setTimeout(r, 5));
  if (change === "path") f.owner.publishEdit(p => ({ ...p, shots: p.shots.map(s => ({ ...s, imagePath: "/w/changed.tiff" })) }), []);
  if (change === "scope") f.owner.publishEdit(p => parkShotGroup(p, ["s"]), []);
  if (change === "delete-recreate") { const previous = f.projectRef.current; f.owner.publishEdit(p => ({ ...p, shots: [] }), []); f.owner.publishEdit(previous, []); }
  gate.release(); expect(await operation).toBe(false); expect(f.persist).not.toHaveBeenCalled();
  expect(f.projectRef.current.pendingBake.shots.s.state).toBe("unknown");
  if (change === "path") expect(f.projectRef.current.shots[0].imagePath).toBe("/w/changed.tiff");
});
it("Pending durable P2 followed by P3 publishes P3 with H1 but reports incomplete", async () => {
  const f = setup(), md = deferred(); f.persist.mockImplementation(async () => md.promise);
  const operation = f.owner.pending(p => parkShotGroup(p, ["s"]), ["s"], true, f.effect);
  await new Promise(r => setTimeout(r, 5)); f.owner.publishEdit(p => ({ ...p, name: "P3" }), ["s"]); md.release();
  expect(await operation).toBe(false); expect(f.projectRef.current.name).toBe("P3");
  expect(f.projectRef.current.pendingBake.shots.s).toMatchObject({ editToken: "t2", acceptedOutputIdentity: h1 });
  expect(await f.owner.autosave()).toBe(true);
});
it.each(["unknown", "corrupt", "future", "future-empty"])("Pending %s is rejected without identity reads or effects", async kind => {
  const f = setup();
  (f.projectRef.current as any).pendingBake = kind === "unknown" ? { version: 1, shots: { s: { state: "unknown" } } } : kind === "corrupt" ? "broken" : { version: 22, shots: {} };
  if (kind === "future-empty") f.projectRef.current.shots = [];
  expect(await f.owner.pending(p => p, ["s"], true, f.effect)).toBe(false);
  expect(f.readIdentity).not.toHaveBeenCalled(); expect(f.effect).not.toHaveBeenCalled(); expect(f.persist).not.toHaveBeenCalled();
});
it("Pending new-folder queued request has zero effects and cannot persist into that folder", async () => {
  const f = setup(), gate = deferred(); const old = f.queue.runExclusive(() => gate.promise); let paths = { folderPath: "/w", metadataPath: "/w/p.json" };
  const move = vi.fn(); const persist = vi.fn();
  const adapter = createNormalSaveAppAdapter({ projectRef: f.projectRef, setProject: () => {}, queue: f.queue, freshToken: () => "t2", api: () => ({ readOutputIdentity: async () => h0, saveWorkspace: vi.fn(), autosaveWorkspace: persist, moveShotsToPending: move, restoreShotsFromPending: move }), paths: () => paths, onSave: () => {}, onError: () => {} });
  const operation = adapter.pending("park", p => parkShotGroup(p, ["s"]), ["s"]); paths = { folderPath: "/new", metadataPath: "/new/p.json" }; gate.release(); await old;
  expect(await operation).toBe(false); expect(move).not.toHaveBeenCalled(); expect(persist).not.toHaveBeenCalled();
});
it("Pending late ACK after A-B-A cannot publish into the new epoch", async () => {
  const f = setup(), gate = deferred(), entered = deferred(); const base = f.effect.getMockImplementation()!;
  f.effect.mockImplementation(async () => { entered.release(); await gate.promise; return base(); });
  const operation = f.owner.pending(p => parkShotGroup(p, ["s"]), ["s"], true, f.effect); await entered.promise;
  const b = f.owner.load({ ...project(), name: "B" }), a = f.owner.load(project()); gate.release();
  expect(await operation).toBe(false); expect(await b).toBe(false); expect(await a).toBe(true);
  expect(f.projectRef.current.shots[0].imagePath).toBe("/w/a.tiff"); expect(f.persist).not.toHaveBeenCalled();
});
it.each(["park", "restore"] as const)("actual drag %s cancellation leaves history and dirty state untouched", async kind => {
  const f = setup(), update = vi.fn(), status = vi.fn(), selection = vi.fn(), target = vi.fn();
  if (kind === "restore") f.projectRef.current = parkShotGroup(f.projectRef.current, ["s"]) as any;
  const before = f.projectRef.current, capture = f.owner.capture();
  const controller = useStoryboardDragEndController({ projectRef: f.projectRef, selectedShotIdsRef: { current: ["s"] },
    pendingTransition: async () => false, capturePendingScope: () => () => true, pendingVersion: () => f.owner.capture().sequence, updateProject: update,
    setStatus: status,
    flushInsertionTargetsFromDragEnd: () => ({ storyboardInsertionTarget: undefined, parkingInsertionTarget: undefined }),
    isDragEndInsideParkingShelf: () => kind === "park", isDragEndInsideStoryboard: () => true, isDragEndPointerInsideStoryboard: () => true,
    inheritSceneMatte: async () => true, queuePasteAnimation: () => {}, resetActiveDragState: () => {}, selectSingleShot: selection, setDeleteTarget: target });
  controller.handleDragEnd({ active: { data: { current: { type: kind === "park" ? "shot" : "parked-shot", shotId: "s" } } }, over: { data: { current: { type: kind === "park" ? "parking-zone" : "empty-board" } } } } as any);
  await new Promise(r => setTimeout(r, 5));
  expect(f.projectRef.current).toBe(before); expect(f.owner.capture()).toEqual(capture);
  expect(update).not.toHaveBeenCalled(); expect(selection).not.toHaveBeenCalled(); expect(target).not.toHaveBeenCalled();
  expect(status.mock.calls.at(-1)![0]).toContain("incomplete");
});
it("restore never consumes an unmaterialized pending token", async () => {
  const f = setup(); f.projectRef.current = parkShotGroup(f.projectRef.current, ["s"]) as any;
  f.projectRef.current.parkedShots![0].imagePath = "/w/Pending/a.tiff";
  f.projectRef.current.pendingBake.shots.s.acceptedOutputIdentity = h1; f.readIdentity.mockImplementation(async () => h1);
  const restored = await f.owner.pending(p => restoreParkedShotGroup(p, ["s"], { type: "empty-board" }, "after"), ["s"], false,
    async () => [{ shotId: "s", sourcePath: "/w/Pending/a.tiff", targetPath: "/w/a.tiff", fileName: "a.tiff", outputHash: h1, capturedToken: "t1" }]);
  expect(restored).toBe(true); expect(f.projectRef.current.pendingBake.shots.s).toMatchObject({ state: "pending", editToken: "t1", acceptedOutputIdentity: h1 });
});
it.each(["unknown", "corrupt", "future"])("load %s refuses automatic parked migration before any materialization", async kind => {
  const f = setup(), parked = parkShotGroup(project(), ["s"]), effect = vi.fn(), error = vi.fn();
  (parked as any).pendingBake = kind === "unknown" ? { version: 1, shots: { s: { state: "unknown" } } } : kind === "corrupt" ? [] : { version: 42, shots: {} };
  const persist = vi.fn(); const adapter = createNormalSaveAppAdapter({ projectRef: f.projectRef, setProject: () => {}, queue: f.queue, freshToken: () => "t2",
    api: () => ({ readOutputIdentity: async () => h0, saveWorkspace: vi.fn(), autosaveWorkspace: persist, moveShotsToPending: effect, restoreShotsFromPending: effect }),
    paths: () => ({ folderPath: "/w", metadataPath: "/w/p.json" }), onSave: () => {}, onError: error });
  expect(await adapter.load(async () => ({ folderPath: "/w", metadataPath: "/w/p.json", folderName: "w", images: [], project: parked }), () => {})).toBe(false);
  expect(effect).not.toHaveBeenCalled(); expect(persist).not.toHaveBeenCalled(); expect(error).toHaveBeenCalledOnce();
});
it("queued stale Pending and unknown/future empty cannot reach the effect", async () => {
  const f = setup(), gate = deferred(); const old = f.queue.runExclusive(() => gate.promise);
  const pending = (f.owner as any).pending((p: any) => parkShotGroup(p, ["s"]), ["s"], true, f.effect);
  f.owner.publishEdit(p => ({ ...p, name: "P2" }), ["s"]); gate.release(); await old;
  expect(await pending).toBe(false); expect(f.effect).not.toHaveBeenCalled();
  for (const raw of [{ version: 2, shots: {} }, { version: 1, shots: { s: { state: "unknown" } } }]) {
    (f.projectRef.current as any).pendingBake = raw;
    expect(await (f.owner as any).pending((p: any) => p, [], true, f.effect)).toBe(false);
  }
  expect(f.effect).not.toHaveBeenCalled();
});
