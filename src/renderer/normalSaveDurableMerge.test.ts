import { describe, expect, it } from "vitest";
import { createProject } from "../shared/projectOps";
import { initializeCompletedShot } from "../shared/pendingBake";
import { createBitmapLayerWriteQueue } from "./bitmapLayerWriteQueue";
import { createNormalSaveProjectOwner } from "./normalSaveProjectOwner";

// Owner seam: persistence/cleanup ports are explicit boundary substitutes here.
// Filesystem and actual controller wiring are verified separately.
it("publishes History once and cleans only after the exact required persistence ACK", async () => {
  const hash = "1".repeat(64);
  const initial = createProject("durable merge");
  initial.shots = [{ id: "s", imagePath: "/owned/s.tiff", fileName: "s.tiff", order: 0,
    swb: { version: 1, status: "owned", canvasWidth: 2, canvasHeight: 2 } }];
  const ref = { current: initializeCompletedShot(initial, "s", hash, "initial") };
  const queue = createBitmapLayerWriteQueue();
  const events: string[] = [];
  let fail = true;
  const persist = async () => { events.push("persist"); if (fail) throw Error("required MD"); };
  const owner = createNormalSaveProjectOwner({ projectRef: ref, setProject: () => {}, queue,
    freshToken: () => "merge", readIdentity: async () => hash, persist,
    captureEffectPersistence: () => ({ folderPath: "/owned", metadataPath: "/owned/project.json", persist }),
    output: async () => [] });
  const completed = owner.captureEffectCompletion();
  const hooks = { published: () => events.push("history"),
    afterDurable: async (project: typeof initial) => { expect(project).toBe(ref.current); events.push("cleanup"); } };
  await expect(queue.runExclusive(() => completed(p => ({ ...p, name: "Merged" }), ["s"], hooks))).rejects.toThrow("required MD");
  expect(events).toEqual(["history", "persist"]);
  expect(owner.captureEffectAdmission()()).toBe(false);
  fail = false;
  await owner.save();
  expect(events).toEqual(["history", "persist", "persist", "cleanup"]);
  expect(ref.current.name).toBe("Merged");
});
