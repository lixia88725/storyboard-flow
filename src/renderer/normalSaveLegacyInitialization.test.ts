import { expect, it, vi } from "vitest";
import { createProject } from "../shared/projectOps";
import { createBitmapLayerWriteQueue } from "./bitmapLayerWriteQueue";
import { createNormalSaveProjectOwner, type NormalSaveOwnerPorts } from "./normalSaveProjectOwner";
import { createNormalSaveAppAdapter } from "./normalSaveAppAdapter";
import type { Project } from "../shared/types";
const hash = "a".repeat(64);
const legacy = (): Project => ({ ...createProject("legacy"), shots: [{ id: "s", imagePath: "/s.tiff", fileName: "s.tiff", order: 0 }] });
it("missing-envelope load initializes only the actual equivalence-certified shot and rechecks original identity", async () => {
  const p = legacy(); p.shots.push({ ...p.shots[0], id: "unproved", imagePath: "/other.tiff" });
  const projectRef = { current: createProject("empty") };
  const readLegacyIdentity = vi.fn(async (_p: Project, shot: Project["shots"][number]) => shot.id === "s" ? hash : undefined);
  const readIdentity = vi.fn(async () => hash);
  const ports = { projectRef, setProject: () => {}, queue: createBitmapLayerWriteQueue(), freshToken: () => "t", readIdentity,
    readLegacyIdentity, persist: async () => {}, output: async () => [] } as NormalSaveOwnerPorts;
  const owner = createNormalSaveProjectOwner(ports);
  expect(await owner.load(async () => p)).toBe(true);
  expect(projectRef.current.pendingBake?.shots.s).toEqual({ state: "synced", acceptedOutputIdentity: hash });
  expect(projectRef.current.pendingBake?.shots.unproved).toEqual({ state: "unknown" });
  expect(readIdentity).toHaveBeenCalledWith(p.shots[0]);
});
it("actual dormant App adapter requests main equivalence, not arbitrary original hash legacy certification", async () => {
  const projectRef = { current: createProject("empty") };
  const readOutputIdentity = vi.fn(async () => hash);
  const adapter = createNormalSaveAppAdapter({ projectRef, setProject: () => {}, queue: createBitmapLayerWriteQueue(), freshToken: () => "t",
    api: () => ({ readOutputIdentity, autosaveWorkspace: async () => {}, saveWorkspace: async p => p }),
    paths: () => ({ folderPath: "/", metadataPath: "/p.json" }), onSave: () => {}, onError: () => {} });
  const p = legacy();
  await adapter.load(async () => ({ folderPath: "/", folderName: "legacy", metadataPath: "/p.json", project: p, images: [] }), () => {});
  expect(readOutputIdentity.mock.calls).toContainEqual(["/s.tiff", { project: p, folderPath: "/", shotId: "s" }]);
  expect(projectRef.current.pendingBake?.shots.s.state).toBe("synced");
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
it("load preserves explicit unknown/corrupt/future raw and never attempts a legacy proof for them", async () => {
  for (const raw of [{ version: 1, shots: { s: { state: "unknown" } } }, { version: 9, shots: {} }, "corrupt", { version: 1, shots: { s: { state: "synced", acceptedOutputIdentity: "bad" } } }]) {
    const p = { ...legacy(), pendingBake: raw } as Project;
    const projectRef = { current: createProject("empty") }, proof = vi.fn(async () => hash);
    const owner = createNormalSaveProjectOwner({ projectRef, setProject: () => {}, queue: createBitmapLayerWriteQueue(), freshToken: () => "t", readIdentity: async () => hash,
      readLegacyIdentity: proof, persist: async () => {}, output: async () => [] });
    await owner.load(async () => p);
    expect(projectRef.current.pendingBake).toEqual(raw);
    expect(proof).not.toHaveBeenCalled();
    expect(await owner.autosave()).toBe(false);
  }
});
it("legacy proof hash does not certify a source whose identity changed before final reader recheck", async () => {
  const projectRef = { current: createProject("empty") };
  const owner = createNormalSaveProjectOwner({ projectRef, setProject: () => {}, queue: createBitmapLayerWriteQueue(), freshToken: () => "t", readIdentity: async () => "b".repeat(64),
    readLegacyIdentity: async () => hash, persist: async () => {}, output: async () => [] });
  await owner.load(async () => legacy());
  expect(projectRef.current.pendingBake?.shots.s).toEqual({ state: "unknown" });
});
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
it("new epoch waits for old proof to settle and old proof cannot publish into the new workspace", async () => {
  const gate = deferred(), entered = deferred(), queue = createBitmapLayerWriteQueue();
  const projectRef = { current: createProject("empty") }, publications: string[] = [];
  const owner = createNormalSaveProjectOwner({ projectRef, setProject: p => { publications.push(p.name); }, queue, freshToken: () => "t", readIdentity: async () => hash,
    readLegacyIdentity: async () => { entered.resolve(); await gate.promise; return hash; }, persist: async () => {}, output: async () => [] });
  const old = owner.load(async () => legacy()); await entered.promise;
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
    readLegacyIdentity: async () => hash, persist: async () => { entered.resolve(); await gate.promise; events.push("old-io-settled"); }, output: async () => [] });
  const old = owner.autosave(); await entered.promise;
  const reader = vi.fn(async () => { events.push("read"); return legacy(); });
  const loading = owner.load(reader, () => { events.push("onLoaded"); expect(projectRef.current.pendingBake?.shots.s.state).toBe("synced"); });
  const next = queue.runExclusive(async () => { events.push("next-domain"); expect(projectRef.current.name).toBe("legacy"); });
  await Promise.resolve(); expect(reader).not.toHaveBeenCalled(); gate.resolve();
  expect(await old).toBe(false); expect(await loading).toBe(true); await next;
  expect(events).toEqual(["old-io-settled", "read", "publish", "onLoaded", "next-domain"]);
});
