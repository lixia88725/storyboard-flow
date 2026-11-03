import { expect, it, vi } from "vitest";
import { createProject } from "../shared/projectOps";
import { createBitmapLayerWriteQueue } from "./bitmapLayerWriteQueue";
import { createNormalSaveProjectOwner } from "./normalSaveProjectOwner";
import { createNormalSaveAppAdapter } from "./normalSaveAppAdapter";
import type { Project } from "../shared/types";
const hash = "a".repeat(64);
const legacy = (): Project => ({ ...createProject("legacy"), shots: [{ id: "s", imagePath: "/s.tiff", fileName: "s.tiff", order: 0 }] });
it("missing-envelope load no longer attempts equivalence or certifies legacy shots", async () => {
  const p = legacy(); p.shots.push({ ...p.shots[0], id: "unproved", imagePath: "/other.tiff" });
  const projectRef = { current: createProject("empty") };
  const readIdentity = vi.fn(async () => hash);
  const ports = { projectRef, setProject: () => {}, queue: createBitmapLayerWriteQueue(), freshToken: () => "t", readIdentity,
    persist: async () => {}, output: async () => [] };
  const owner = createNormalSaveProjectOwner(ports);
  expect(await owner.load(async () => p)).toBe(true);
  expect(projectRef.current.pendingBake?.shots.s).toEqual({ state: "unknown" });
  expect(projectRef.current.pendingBake?.shots.unproved).toEqual({ state: "unknown" });
  expect(readIdentity).not.toHaveBeenCalled();
  expect(await owner.autosave()).toBe(false);
});
it("App adapter does not request the retired legacy proof", async () => {
  const projectRef = { current: createProject("empty") };
  const readOutputIdentity = vi.fn(async () => hash);
  const adapter = createNormalSaveAppAdapter({ projectRef, setProject: () => {}, queue: createBitmapLayerWriteQueue(), freshToken: () => "t",
    api: () => ({ readOutputIdentity, autosaveWorkspace: async () => {}, saveWorkspace: async p => p }),
    paths: () => ({ folderPath: "/", metadataPath: "/p.json" }), onSave: () => {}, onError: () => {} });
  const p = legacy();
  await adapter.load(async () => ({ folderPath: "/", folderName: "legacy", metadataPath: "/p.json", project: p, images: [] }), () => {});
  expect(readOutputIdentity).not.toHaveBeenCalled();
  expect(projectRef.current.pendingBake?.shots.s.state).toBe("unknown");
});
it("dormant App autosave opts into the actual main sideeffect admission", async () => {
  const projectRef = { current: createProject("empty") };
  const autosaveWorkspace = vi.fn(async () => {});
  const adapter = createNormalSaveAppAdapter({ projectRef, setProject: () => {}, queue: createBitmapLayerWriteQueue(), freshToken: () => "t",
    api: () => ({ readOutputIdentity: async () => hash, autosaveWorkspace, saveWorkspace: async p => p }),
    paths: () => ({ folderPath: "/", metadataPath: "/p.json" }), onSave: () => {}, onError: () => {} });
  expect(await adapter.autosave(projectRef.current)).toBe(true);
  expect(autosaveWorkspace.mock.calls).toEqual([[{ project: projectRef.current, folderPath: "/", metadataPath: "/p.json", normalSave: true,
    recoveryContent: { projectRaw: projectRef.current, sequence: 0, assetRevision: 0, desiredAssets: [], deletedDependencies: [], retainedAssetIntents: [], recoveryRequired: false,
      effectFacts: { unsettled: false, receipt: [], deletions: [], remainingScript: null, error: null } }, recoverySaveNonce: undefined }]]);
});
it("load preserves explicit unknown/corrupt/future raw without reading TIFF identities", async () => {
  for (const raw of [{ version: 1, shots: { s: { state: "unknown" } } }, { version: 9, shots: {} }, "corrupt", { version: 1, shots: { s: { state: "synced", acceptedOutputIdentity: "bad" } } }]) {
    const p = { ...legacy(), pendingBake: raw } as Project;
    const projectRef = { current: createProject("empty") }, readIdentity = vi.fn(async () => hash);
    const owner = createNormalSaveProjectOwner({ projectRef, setProject: () => {}, queue: createBitmapLayerWriteQueue(), freshToken: () => "t", readIdentity,
      persist: async () => {}, output: async () => [] });
    await owner.load(async () => p);
    expect(projectRef.current.pendingBake).toEqual(raw);
    expect(readIdentity).not.toHaveBeenCalled();
    expect(await owner.autosave()).toBe(false);
  }
});
it("current project output identity mismatch still prevents overwriting", async () => {
  const projectRef = { current: createProject("empty") };
  const owner = createNormalSaveProjectOwner({ projectRef, setProject: () => {}, queue: createBitmapLayerWriteQueue(), freshToken: () => "t", readIdentity: async () => "b".repeat(64),
    persist: async () => {}, output: async () => [] });
  await owner.load(async () => ({ ...legacy(), pendingBake: { version: 1, shots: { s: { state: 'synced', acceptedOutputIdentity: hash } } } }));
  expect(projectRef.current.pendingBake?.shots.s.state).toBe("unknown");
  expect(await owner.autosave()).toBe(false);
});
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
it("new epoch waits for old reader to settle and old reader cannot publish into the new workspace", async () => {
  const gate = deferred(), entered = deferred(), queue = createBitmapLayerWriteQueue();
  const projectRef = { current: createProject("empty") }, publications: string[] = [];
  const owner = createNormalSaveProjectOwner({ projectRef, setProject: p => { publications.push(p.name); }, queue, freshToken: () => "t", readIdentity: async () => hash,
    persist: async () => {}, output: async () => [] });
  const old = owner.load(async () => { entered.resolve(); await gate.promise; return legacy(); }); await entered.promise;
  const reader = vi.fn(async () => createProject("new epoch"));
  const next = owner.load(reader); await Promise.resolve(); expect(reader).not.toHaveBeenCalled();
  gate.resolve(); expect(await old).toBe(false); expect(await next).toBe(true);
  expect(publications).toEqual(["new epoch"]);
  expect(projectRef.current.name).toBe("new epoch");
});
it("same-folder reload reader runs only after admitted old persistence settles; initialized publication happens before release", async () => {
  const gate = deferred(), entered = deferred(), queue = createBitmapLayerWriteQueue();
  const projectRef = { current: createProject("empty") }, events: string[] = [];
  const owner = createNormalSaveProjectOwner({ projectRef, setProject: () => { events.push("publish"); }, queue, freshToken: () => "t", readIdentity: async () => hash,
    persist: async () => { entered.resolve(); await gate.promise; events.push("old-io-settled"); }, output: async () => [] });
  const old = owner.autosave(); await entered.promise;
  const reader = vi.fn(async () => { events.push("read"); return { ...legacy(), pendingBake: { version: 1 as const, shots: { s: { state: 'synced' as const, acceptedOutputIdentity: hash } } } }; });
  const loading = owner.load(reader, () => { events.push("onLoaded"); expect(projectRef.current.pendingBake?.shots.s.state).toBe("synced"); });
  const next = queue.runExclusive(async () => { events.push("next-domain"); expect(projectRef.current.name).toBe("legacy"); });
  await Promise.resolve(); expect(reader).not.toHaveBeenCalled(); gate.resolve();
  expect(await old).toBe(false); expect(await loading).toBe(true); await next;
  expect(events).toEqual(["old-io-settled", "read", "publish", "onLoaded", "next-domain"]);
});
