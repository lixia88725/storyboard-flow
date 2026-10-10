import { describe, expect, it, vi } from "vitest";
// Synchronous hook scaffold only; real mounted lifecycle is exercised by the
// guarded Electron smoke. Actual controller, owner, queue and filesystem remain real.
vi.mock("react", () => ({
  useState: (value: unknown) => [value, (next: unknown) => { value = typeof next === "function" ? next(value) : next; }],
  useRef: (current: unknown) => ({ current }), useEffect: (effect: () => void) => effect(), useCallback: (fn: unknown) => fn
}));
import { mkdtemp, cp, readFile, writeFile, rm } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { createNormalSaveProjectOwner } from "./normalSaveProjectOwner";
import { createBitmapLayerWriteQueue } from "./bitmapLayerWriteQueue";
import { deleteShots } from "../shared/projectOps";
import type { Project, Shot } from "../shared/types";
import { serializeStoryboardScriptMarkdown } from "../../electron/main/storyboardScript";
import { useProjectHistoryController } from "./projectHistoryController";
const evidence = path.resolve("research/core-closeout/save-normal-first-block/metadata-history-fixture");
async function fixture() {
  const input = JSON.parse(await readFile(path.join(evidence, "input.json"), "utf8"));
  const original: Project = input.project;
  const oldFolder: string = input.originalFolder;
  const folder = await mkdtemp(path.join(process.env.TMPDIR!, "metadata-history-"));
  await cp(path.join(evidence, "assets"), folder, { recursive: true });
  const project: Project = JSON.parse(JSON.stringify(original).split(oldFolder).join(folder));
  const ref = { current: project }, queue = createBitmapLayerWriteQueue();
  let identityReads = 0, persists = 0;
  let beforeRead: (() => Promise<void>) | undefined;
  const hash = async (s: Shot) => createHash("sha256").update(await readFile(s.imagePath)).digest("hex");
  const owner = createNormalSaveProjectOwner({ projectRef: ref, setProject: () => {}, queue, freshToken: randomUUID,
    readIdentity: async s => { identityReads++; await beforeRead?.(); return hash(s); },
    persist: async p => { persists++; await writeFile(path.join(folder, ".storyboard-workbench/storyboard.project.json"), JSON.stringify(p)); await writeFile(path.join(folder, "storyboard-script.md"), serializeStoryboardScriptMarkdown(p)); },
    output: async () => { throw Error("No TIFF output allowed in metadata history"); } });
  const ids: string[] = input.targetIds;
  const publish = (p: Project, dirty = ids) => queue.runExclusive(() => owner.publishMetadataHistory(p, dirty));
  return { owner, ref, queue, project, ids, folder, publish, hash,
    get reads() { return identityReads; }, get persists() { return persists; },
    set beforeRead(v: (() => Promise<void>) | undefined) { beforeRead = v; },
    cleanup: () => rm(folder, { recursive: true, force: true }) };
}
describe("owner-certified metadata Delete History using captured real App inputs", () => {
  const history = (f: Awaited<ReturnType<typeof fixture>>) => {
    const selected = { current: f.ids }, statuses: string[] = [];
    const controller = useProjectHistoryController({
      captureWorkspace: () => f.owner.captureEffectAdmission(), isImageImportLocked: () => false,
      api: undefined, bitmapLayerWriteQueueRef: { current: f.queue }, fileNameSyncStateRef: { current: "unsynced" },
      folderPathRef: { current: f.folder }, markShotsDirty: () => {}, maxEntries: 60,
      publishProject: f.owner.publishEdit, publishMetadataProject: f.owner.publishMetadataHistory,
      projectRef: f.ref, scriptImportCheckIdRef: { current: 0 }, selectShotsByIds: ids => { selected.current = ids; },
      selectedShotIdsRef: selected, setAutosaveRevision: () => {}, setFileNameSyncState: () => {},
      setProject: () => { throw Error("Legacy Project setter must not replace owner"); }, setScriptImportNeeded: () => {},
      setStatus: text => statuses.push(text), setWorkspaceSaveState: () => {}
    });
    return { ...controller, selected, statuses };
  };
  it("restores current retained pending without trusting the historical envelope; persists actual JSON/MD only", async () => {
    const f = await fixture();
    try {
      const bytes = await readFile(f.project.shots.find(s => s.id === f.ids[0])!.imagePath);
      expect(f.owner.publishEdit(deleteShots(f.project, f.ids), [])).toBe(true);
      expect(f.owner).toHaveProperty("publishMetadataHistory");
      const pending = f.ref.current.pendingBake!;
      const restored = { ...f.project, pendingBake: undefined };
      expect(await f.publish(restored)).toBe(true);
      expect(f.ref.current.pendingBake!.shots[f.ids[0]].state).toBe("pending");
      expect(f.ref.current.pendingBake!.shots[f.ids[0]].acceptedOutputIdentity).toBe(pending.shots[f.ids[0]].acceptedOutputIdentity);
      expect(await f.owner.autosave()).toBe(true);
      expect(JSON.parse(await readFile(path.join(f.folder, ".storyboard-workbench/storyboard.project.json"), "utf8")).shots).toHaveLength(3);
      expect(await readFile(path.join(f.folder, "storyboard-script.md"), "utf8")).toBe(serializeStoryboardScriptMarkdown(f.ref.current));
      expect(await readFile(f.project.shots.find(s => s.id === f.ids[0])!.imagePath)).toEqual(bytes);
    } finally { await f.cleanup(); }
  });
  it("actual History repeatedly restores multi-selection, retains envelope extensions, and retires no TIFF output", async () => {
    const f = await fixture();
    try {
      const h = history(f), ids = f.project.shots.slice(0, 2).map(s => s.id);
      const snapshot = structuredClone(f.project);
      const envelope = f.ref.current.pendingBake! as typeof f.ref.current.pendingBake & { vendor?: string };
      envelope.vendor = "retained-current-extension";
      for (const id of ids) Object.assign(envelope.shots[id], { vendor: "current-shot-extension" });
      h.recordProjectUndoEntry();
      expect(f.owner.publishEdit(deleteShots(f.ref.current, ids), [])).toBe(true);
      for (let round = 0; round < 3; round++) {
        await h.applyUndoEntry();
        expect(f.ref.current.shots).toHaveLength(3);
        expect(h.statuses.at(-1)).toBe("Undid last change");
        expect(f.ref.current.pendingBake).toMatchObject({ vendor: "retained-current-extension" });
        for (const id of ids) expect(f.ref.current.pendingBake!.shots[id]).toMatchObject({ state: "pending", vendor: "current-shot-extension" });
        expect(await f.owner.autosave()).toBe(true);
        await h.applyRedoEntry();
        expect(f.ref.current.shots).toHaveLength(1);
        expect(h.statuses.at(-1)).toBe("Redid last change");
      }
      expect(snapshot.shots.map(s => s.imagePath)).toEqual(f.project.shots.map(s => s.imagePath));
    } finally { await f.cleanup(); }
  });
  for (const state of ["pending", "synced"] as const) it(`restores current ${state} obligation without using history token/H0`, async () => {
    const f = await fixture();
    try {
      if (state === "synced") { f.ref.current.pendingBake!.shots[f.ids[0]].state = "synced"; delete f.ref.current.pendingBake!.shots[f.ids[0]].editToken; }
      const next = structuredClone(f.project);
      expect(f.owner.publishEdit(deleteShots(f.ref.current, f.ids), [])).toBe(true);
      expect(await f.publish(next)).toBe(true);
      expect(f.ref.current.pendingBake!.shots[f.ids[0]].state).toBe("pending");
      expect(f.ref.current.pendingBake!.shots[f.ids[0]].editToken).toBeTruthy();
    } finally { await f.cleanup(); }
  });
  const negatives: Array<[string, (p: Project, next: Project, id: string) => void]> = [
    ["unknown", (p, _n, id) => { p.pendingBake!.shots[id] = { state: "unknown" }; }],
    ["future", p => { (p.pendingBake as unknown as { version: number }).version = 2; }],
    ["corrupt", p => { p.pendingBake = { version: 1, shots: null } as unknown as Project["pendingBake"]; }],
    ["missing entry", (p, _n, id) => { delete p.pendingBake!.shots[id]; }],
    ["missing tombstone / deletion installed by Save", p => { p.pendingDeletedShots = []; }],
    ["tombstone path changed", p => { p.pendingDeletedShots![0].imagePath += ".different"; }],
    ["target path changed", (_p, n, id) => { n.shots.find(s => s.id === id)!.imagePath += ".different"; }],
    ["unrelated source path changed", (_p, n, id) => { n.shots.find(s => s.id !== id)!.imagePath += ".different"; }],
    ["duplicate deletion record", p => { p.pendingDeletedShots!.push({ ...p.pendingDeletedShots![0], imagePath: "different" }); }],
    ["target TIFF inputs changed / ID reused", (_p, n, id) => { n.shots.find(s => s.id === id)!.swb = { ...n.shots.find(s => s.id === id)!.swb!, canvasWidth: 1 }; }],
    ["workspace changed", (_p, n) => { n.id += "-other"; }]
  ];
  for (const [name, mutate] of negatives) it(`refuses ${name}, leaves actual History retryable and Project/selection/disk unchanged`, async () => {
    const f = await fixture();
    try {
      const h = history(f), next = structuredClone(f.project);
      h.recordProjectUndoEntry();
      expect(f.owner.publishEdit(deleteShots(f.ref.current, f.ids), [])).toBe(true);
      mutate(f.ref.current, next, f.ids[0]);
      const before = f.ref.current, encoded = JSON.stringify(before), selected = [...h.selected.current];
      const disk = await readFile(path.join(f.folder, ".storyboard-workbench/storyboard.project.json"));
      // Target mutation belongs to the actual captured History entry, not a permission flag.
      h.resetHistoryStacks(); h.recordUndoEntry({ project: next, selectedShotIds: f.ids, fileNameSyncState: "unsynced", layerAssets: [] });
      await h.applyUndoEntry(); await h.applyUndoEntry();
      expect(f.ref.current).toBe(before); expect(JSON.stringify(f.ref.current)).toBe(encoded);
      expect(h.selected.current).toEqual(selected); expect(f.persists).toBe(0);
      expect(await readFile(path.join(f.folder, ".storyboard-workbench/storyboard.project.json"))).toEqual(disk);
      expect(h.statuses.every(s => !s.startsWith("Undid"))).toBe(true);
    } finally { await f.cleanup(); }
  });
  it("refuses changed real root bytes and a constructed/reopened tombstone without a live owner witness", async () => {
    const f = await fixture();
    try {
      expect(f.owner.publishEdit(deleteShots(f.project, f.ids), [])).toBe(true);
      const before = f.ref.current;
      await writeFile(f.project.shots.find(s => s.id === f.ids[0])!.imagePath, "changed fixture root bytes");
      expect(await f.publish(f.project)).toBe(false); expect(f.ref.current).toBe(before);
      const fresh = createNormalSaveProjectOwner({ projectRef: f.ref, setProject: () => {}, queue: f.queue, freshToken: randomUUID,
        readIdentity: f.hash, persist: async () => { throw Error("No write"); }, output: async () => [] });
      expect(await f.queue.runExclusive(() => fresh.publishMetadataHistory(f.project, f.ids))).toBe(false);
      expect(fresh.publishEdit(f.project, f.ids)).toBe(false); expect(f.ref.current).toBe(before);
    } finally { await f.cleanup(); }
  });
  for (const mode of ["new-edit", "A-B-A"] as const) it(`rejects ${mode} during real identity await without losing newer metadata`, async () => {
    const f = await fixture();
    try {
      expect(f.owner.publishEdit(deleteShots(f.project, f.ids), [])).toBe(true);
      let release!: () => void, entered!: () => void;
      const gate = new Promise<void>(r => { release = r; }), started = new Promise<void>(r => { entered = r; });
      f.beforeRead = async () => { entered(); await gate; };
      const attempt = f.publish(f.project); await started;
      let loads: Promise<boolean>[] = [];
      if (mode === "new-edit") f.owner.publishEdit(p => ({ ...p, name: "newer metadata" }), []);
      else { loads = [f.owner.load({ ...f.project, id: "B" }), f.owner.load(f.ref.current)]; }
      const current = f.ref.current;
      f.beforeRead = undefined; release();
      expect(await attempt).toBe(false); expect(f.ref.current).toBe(current);
      await Promise.all(loads); expect(f.persists).toBe(0);
      if (mode === "new-edit") expect(f.ref.current.name).toBe("newer metadata");
    } finally { await f.cleanup(); }
  });
});
