import { expect, it } from "vitest";
import { createProject, deleteShots } from "../shared/projectOps";
import type { Project } from "../shared/types";
import { createNormalSaveProjectOwner } from "./normalSaveProjectOwner";
import { createBitmapLayerWriteQueue } from "./bitmapLayerWriteQueue";
import type { NormalSaveCompletion } from "../../electron/normalSaveTransport";

// Real owner/queue/metadata Delete. Output and required disk persistence are explicit
// fixture ports; actual main/filesystem deletion is covered separately.
function fixture(state: "pending" | "synced" = "pending", mixed = false) {
  const p = createProject("ack");
  p.shots = ["d", ...(mixed ? ["a"] : [])].map(id => ({ id, imagePath: `/owned/${id}.tiff`, fileName: `${id}.tiff`, order: 0,
    swb: { version: 1, status: "owned", canvasWidth: 1, canvasHeight: 1 } }));
  p.pendingBake = { version: 1, envelopeExtension: { keep: 3 }, shots: Object.fromEntries(p.shots.map(s => [s.id,
    { state, ...(state === "pending" ? { editToken: `t-${s.id}` } : {}), acceptedOutputIdentity: "a".repeat(64), extension: { keep: 1 } }])) } as Project["pendingBake"];
  const ref = { current: p }; let outputs = 0, persists = 0, fault = false, actualIdentity = "a".repeat(64);
  let during: (() => void | Promise<void>) | undefined;
  let completion: NormalSaveCompletion | undefined;
  const owner = createNormalSaveProjectOwner({ projectRef: ref, setProject: () => {}, queue: createBitmapLayerWriteQueue(), freshToken: () => "P2-token",
    readIdentity: async () => actualIdentity,
    persist: async () => { persists++; if (fault) throw new Error("required JSON/MD fault"); },
    output: async captured => { outputs++; await during?.(); actualIdentity = "b".repeat(64); return completion ?? { outputs: captured.shots.map(s => ({ shotId: s.id,
      capturedToken: captured.pendingBake!.shots[s.id].editToken, sourcePath: s.imagePath, targetPath: s.imagePath, outputHash: "b".repeat(64) })),
      deletions: [{ shotId: "d", sourcePath: "/owned/d.tiff" }] }; } });
  expect(owner.publishEdit(deleteShots(ref.current, ["d"]), [])).toBe(true);
  return { owner, ref, p, get outputs() { return outputs; }, get persists() { return persists; }, set fault(v: boolean) { fault = v; },
    set during(v: typeof during) { during = v; }, set completion(v: typeof completion) { completion = v; } };
}
it.each(["pending", "synced"] as const)("retires only the actual last-shot %s deletion ACK", async state => {
  const f = fixture(state); expect(await f.owner.save()).toBe(true);
  expect(f.outputs).toBe(1); expect(f.ref.current.pendingDeletedShots).toEqual([]);
  expect(f.ref.current.pendingBake).toEqual({ version: 1, envelopeExtension: { keep: 3 }, shots: {} });
  expect(f.owner.hasUnsavedWork()).toBe(false);
});
it.each(["JSON", "MD"])("retains completion receipt across required %s failure without repeating output", async () => {
  const f = fixture(); f.fault = true; expect(await f.owner.save()).toBe(false);
  expect(f.owner.hasUnsavedWork()).toBe(true); expect(await f.owner.autosave()).toBe(false);
  f.fault = false; expect(await f.owner.save()).toBe(true); expect(f.outputs).toBe(1); expect(f.persists).toBe(2);
});
it("preserves P2 token/metadata and unrelated pending while merging mixed actual outputs", async () => {
  const f = fixture("pending", true);
  f.during = () => { expect(f.owner.publishEdit(p => ({ ...p, shots: p.shots.map(s => ({ ...s, scriptText: "P2" })) }), ["a"])).toBe(true); };
  expect(await f.owner.save()).toBe(false);
  expect(f.ref.current.shots[0].scriptText).toBe("P2");
  expect(f.ref.current.pendingBake!.shots.a).toEqual({ state: "pending", editToken: "P2-token", acceptedOutputIdentity: "b".repeat(64), extension: { keep: 1 } });
  expect(f.ref.current.pendingBake!.shots.d).toBeUndefined();
});
it.each(["record", "entry", "duplicate", "active", "parked", "path", "project"])("rejects changed %s rather than retiring a newer deletion", async kind => {
  const f = fixture();
  f.during = () => {
    const p = f.ref.current;
    const next = structuredClone(p);
    if (kind === "record") Object.assign(next.pendingDeletedShots![0], { extension: { newer: true } });
    if (kind === "entry") Object.assign(next.pendingBake!.shots.d, { extension: { newer: true } });
    if (kind === "duplicate") next.pendingDeletedShots!.push({ ...next.pendingDeletedShots![0] });
    if (kind === "active") next.shots.push(f.p.shots[0]);
    if (kind === "parked") next.parkedShots = [f.p.shots[0]];
    if (kind === "path") next.pendingDeletedShots![0].imagePath = "/owned/new.tiff";
    if (kind === "project") next.id = "other-workspace";
    // Hostile raw ref replacement also must fail exact ACK validation; generic
    // publishEdit deliberately does not grant entry replacement/restoration.
    f.ref.current = next;
  };
  expect(await f.owner.save()).toBe(false); expect(f.ref.current.pendingDeletedShots?.length).toBeGreaterThan(0); expect(f.persists).toBe(0);
});
it("cannot borrow an ACK after same-ID/path/bytes lifecycle recreation", async () => {
  const f = fixture();
  f.during = async () => {
    expect(await f.owner.publishMetadataHistory(f.p, ["d"])).toBe(true);
    expect(f.owner.publishEdit(deleteShots(f.ref.current, ["d"]), [])).toBe(true);
  };
  expect(await f.owner.save()).toBe(false); expect(f.persists).toBe(0);
});
it.each([undefined, [], [{ shotId: "d", sourcePath: "/wrong" }]])("does not infer completion from missing/incorrect deletion ACK %j", async deletions => {
  const f = fixture("synced"); f.completion = { outputs: [], deletions: deletions ?? [] };
  expect(await f.owner.save()).toBe(false); expect(f.ref.current.pendingDeletedShots).toHaveLength(1);
});
it("actual Save retirement rejects old metadata Undo even if the original bytes reappear", async () => {
  const f = fixture();
  expect(await f.owner.save()).toBe(true);
  const after = f.ref.current;
  expect(await f.owner.publishMetadataHistory(f.p, ["d"])).toBe(false);
  expect(f.ref.current).toBe(after);
});
it.each(["unknown", "future", "corrupt"])("deletion Save preserves %s raw obligations without output", async kind => {
  const f = fixture();
  if (kind === "unknown") f.ref.current.pendingBake!.shots.d = { state: "unknown", extension: "keep" } as any;
  if (kind === "future") f.ref.current.pendingBake = { version: 19, shots: {}, future: "keep" } as any;
  if (kind === "corrupt") f.ref.current.pendingBake = { version: 1, shots: "corrupt", extension: "keep" } as any;
  const before = JSON.stringify(f.ref.current);
  expect(await f.owner.save()).toBe(false); expect(f.outputs).toBe(0); expect(JSON.stringify(f.ref.current)).toBe(before);
});
it("cannot publish a deletion ACK across workspace/epoch replacement", async () => {
  const f = fixture(); let loaded: Promise<boolean> | undefined;
  f.during = () => { loaded = f.owner.load(createProject("B")); };
  expect(await f.owner.save()).toBe(false); expect(await loaded).toBe(true);
  expect(f.ref.current.name).toBe("B"); expect(f.persists).toBe(0);
});
